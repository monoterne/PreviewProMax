use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, Window};

fn can_position(window: &Window) -> bool {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        // Wayland leaves toplevel placement to the compositor.
        window
            .gtk_window()
            .is_ok_and(|gtk| !gtk.display().backend().is_wayland())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = window;
        true
    }
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WindowFrame {
    Macos {
        descriptor: String,
    },
    Desktop {
        position: Option<(i32, i32)>,
        size: (u32, u32),
    },
}

impl WindowFrame {
    pub fn capture(window: &Window) -> Option<Self> {
        if window.is_minimized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
            return None;
        }
        #[cfg(target_os = "macos")]
        if let Some(descriptor) = crate::macos::frame(window) {
            return Some(Self::Macos { descriptor });
        }
        let size = window.inner_size().ok()?;
        if size.width == 0 || size.height == 0 {
            return None;
        }
        Some(Self::Desktop {
            position: if can_position(window) {
                window.outer_position().ok().map(Into::into)
            } else {
                None
            },
            size: size.into(),
        })
    }

    pub fn restore(&self, window: &Window) {
        match self {
            #[cfg(target_os = "macos")]
            Self::Macos { descriptor } => crate::macos::restore_frame(window, descriptor),
            #[cfg(not(target_os = "macos"))]
            Self::Macos { .. } => {}
            Self::Desktop { position, size } => {
                let size = PhysicalSize::<u32>::from(*size);
                if !can_position(window) {
                    let _ = window.set_size(size);
                    return;
                }
                let visible_position = position.filter(|&(x, y)| {
                    window.available_monitors().ok().is_none_or(|monitors| {
                        monitors.is_empty()
                            || monitors.iter().any(|monitor| {
                                let origin = monitor.position();
                                let size = monitor.size();
                                let x = i64::from(x) - i64::from(origin.x);
                                let y = i64::from(y) - i64::from(origin.y);
                                (0..i64::from(size.width)).contains(&x)
                                    && (0..i64::from(size.height)).contains(&y)
                            })
                    })
                });
                if let Some((x, y)) = visible_position {
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                    let _ = window.set_size(size);
                } else if let Some(monitor) = window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| window.primary_monitor().ok().flatten())
                {
                    let available = monitor.work_area().size;
                    let _ = window.set_size(PhysicalSize::new(
                        size.width.min(available.width),
                        size.height.min(available.height),
                    ));
                    let _ = window.center();
                } else {
                    let _ = window.set_size(size);
                }
            }
        }
    }
}
