use block2::RcBlock;
use objc2::{MainThreadMarker, rc::Retained};
use objc2_app_kit::{NSApplication, NSEvent, NSEventMask, NSWindow, NSWindowStyleMask as Style};
use objc2_core_graphics::{CGEvent, CGEventFlags as Modifiers};
use objc2_foundation::{NSPoint, NSRect, NSString};
use std::ptr::{self, NonNull};
use tauri::{AppHandle, Manager, Window};

fn native_window(window: &Window, _mtm: MainThreadMarker) -> Option<Retained<NSWindow>> {
    // Tauri owns the NSWindow. Retain it while calling AppKit on the main thread.
    unsafe { Retained::retain(window.ns_window().ok()?.cast()) }
}

pub fn frame(window: &Window) -> Option<String> {
    let window = native_window(window, MainThreadMarker::new()?)?;
    (!window.styleMask().contains(Style::FullScreen))
        .then(|| window.stringWithSavedFrame().to_string())
}

pub fn restore_frame(window: &Window, frame: &str) {
    if let Some(window) = MainThreadMarker::new().and_then(|mtm| native_window(window, mtm)) {
        window.setFrameFromString(&NSString::from_str(frame));
    }
}

enum Tile {
    Left,
    Right,
    Bottom,
    Top,
}

impl Tile {
    fn from_event(event: &NSEvent) -> Option<Self> {
        // macOS virtual key codes for the four arrow keys.
        let tile = match event.keyCode() {
            123 => Self::Left,
            124 => Self::Right,
            125 => Self::Bottom,
            126 => Self::Top,
            _ => return None,
        };
        // AppKit can set the Function flag for arrow keys even when Fn is up.
        let raw_event = event.CGEvent()?;
        let flags = CGEvent::flags(Some(&raw_event))
            & (Modifiers::MaskSecondaryFn
                | Modifiers::MaskControl
                | Modifiers::MaskShift
                | Modifiers::MaskAlternate
                | Modifiers::MaskCommand);
        (flags == Modifiers::MaskSecondaryFn | Modifiers::MaskControl).then_some(tile)
    }

    fn frame(&self, mut area: NSRect) -> NSRect {
        match self {
            Self::Left | Self::Right => {
                let left_width = (area.size.width / 2.0).floor();
                if matches!(self, Self::Right) {
                    area.origin.x += left_width;
                    area.size.width -= left_width;
                } else {
                    area.size.width = left_width;
                }
            }
            Self::Bottom | Self::Top => {
                let bottom_height = (area.size.height / 2.0).floor();
                if matches!(self, Self::Top) {
                    area.origin.y += bottom_height;
                    area.size.height -= bottom_height;
                } else {
                    area.size.height = bottom_height;
                }
            }
        }
        area
    }
}

fn handle_tiling_key(app: &AppHandle, event: &NSEvent) -> Option<()> {
    let tile = Tile::from_event(event)?;
    let mtm = MainThreadMarker::new()?;
    let application = NSApplication::sharedApplication(mtm);
    let window = event.window(mtm).or_else(|| application.keyWindow())?;
    let style = window.styleMask();
    if !style.contains(Style::Resizable) || style.contains(Style::FullScreen) {
        return None;
    }
    if !app
        .webview_windows()
        .values()
        .any(|viewer| viewer.ns_window().ok() == Some(Retained::as_ptr(&window).cast_mut().cast()))
    {
        return None;
    }
    if application
        .mainMenu()
        .is_some_and(|menu| menu.performKeyEquivalent(event))
    {
        return Some(());
    }
    let frame = tile.frame(window.screen()?.visibleFrame());
    let minimum = window
        .frameRectForContentRect(NSRect::new(NSPoint::ZERO, window.contentMinSize()))
        .size;
    if frame.size.width < minimum.width || frame.size.height < minimum.height {
        return None;
    }
    window.setFrame_display(frame, true);
    Some(())
}

pub fn install_tiling_shortcuts(app: AppHandle) {
    let handler = RcBlock::new(move |event: NonNull<NSEvent>| {
        // AppKit owns the event for this callback. Returning it forwards it unchanged.
        if handle_tiling_key(&app, unsafe { event.as_ref() }).is_some() {
            ptr::null_mut()
        } else {
            event.as_ptr()
        }
    });
    // AppKit retains the local monitor for the lifetime of this process.
    unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &handler)
    };
}
