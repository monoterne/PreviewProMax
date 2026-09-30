// Exercise production assets in the installed macOS WKWebView using Tauri's URL scheme.
// Usage: swift tests/native/viewer.swift PDF QUERY EXPECTED_MATCHES MIN_LOADED_FONTS
import Cocoa
import WebKit

guard CommandLine.arguments.count == 5 else { fatalError("Expected PDF, query, match count, and font count") }
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath + "/dist")
let pdf = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])).base64EncodedString()
let query = String(data: try JSONSerialization.data(withJSONObject: CommandLine.arguments[2], options: .fragmentsAllowed), encoding: .utf8)!
let expectedMatches = Int(CommandLine.arguments[3])!
let minimumFonts = Int(CommandLine.arguments[4])!
let app = NSApplication.shared
app.setActivationPolicy(.accessory)

class Handler: NSObject, WKURLSchemeHandler, WKScriptMessageHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let path = task.request.url!.path
        let file = root.appendingPathComponent(path == "/" ? "index.html" : String(path.dropFirst()))
        do {
            let data = try Data(contentsOf: file)
            let mime = file.pathExtension == "html" ? "text/html" : file.pathExtension == "css" ? "text/css" : "text/javascript"
            task.didReceive(URLResponse(url: task.request.url!, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil))
            task.didReceive(data); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let result = message.body as? [String: Int] else { return }
        print("Native WKWebView: \(result)")
        let pass = result["matches"] == expectedMatches && (result["fonts"] ?? 0) >= minimumFonts && (result["highlights"] ?? 0) > 0 && result["pinch"] == 1
        exit(pass ? 0 : 1)
    }
}
let handler = Handler()
let config = WKWebViewConfiguration()
config.setURLSchemeHandler(handler, forURLScheme: "tauri")
config.userContentController.add(handler, name: "result")
config.userContentController.addUserScript(WKUserScript(source: """
let consumed = false;
window.__TAURI_INTERNALS__ = {
  metadata: {currentWindow: {label: 'main'}, currentWebview: {label: 'main'}}, transformCallback: () => 1,
  invoke: async command => {
    if (command === 'take_pending_document') { if (consumed) return null; consumed = true; return 'fixture.pdf'; }
    if (command === 'get_sessions') return {restore: null, recent: []};
    if (command === 'read_document') return Uint8Array.from(atob('\(pdf)'), c => c.charCodeAt(0));
    return 1;
  }
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {unregisterListener() {}};
let started = false;
setInterval(() => {
  if (!document.querySelector('.page-shell[data-rendered="true"]')) return;
  if (!started) {
    started = true;
    const viewer = document.querySelector('#viewer');
    const shell = document.querySelector('.page-shell');
    const width = shell.getBoundingClientRect().width;
    viewer.dispatchEvent(new Event('gesturestart', {bubbles: true, cancelable: true}));
    const change = new Event('gesturechange', {bubbles: true, cancelable: true});
    Object.assign(change, {scale: 1.1, clientX: shell.getBoundingClientRect().left + width / 2, clientY: shell.getBoundingClientRect().top + 100});
    viewer.dispatchEvent(change);
    window.__pinchSmooth = shell === document.querySelector('.page-shell') && shell.getBoundingClientRect().width > width && !!document.querySelector('#pages').style.zoom;
    viewer.dispatchEvent(new Event('gestureend', {bubbles: true, cancelable: true}));
    document.querySelector('#search-toggle').click();
    const input = document.querySelector('#search-input'); input.value = \(query); input.dispatchEvent(new Event('input'));
    return;
  }
  const status = document.querySelector('#search-status').textContent;
  if (status === 'Searching…' || status === 'Enter text to search.') return;
  window.webkit.messageHandlers.result.postMessage({
    matches: document.querySelectorAll('.search-result').length,
    pinch: window.__pinchSmooth ? 1 : 0,
    highlights: document.querySelectorAll('.search-match').length,
    fonts: [...document.fonts].filter(font => font.family.startsWith('g_') && font.status === 'loaded').length
  });
}, 100);
""", injectionTime: .atDocumentStart, forMainFrameOnly: true))
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1000, height: 760), configuration: config)
let window = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.contentView = view; window.makeKeyAndOrderFront(nil)
view.load(URLRequest(url: URL(string: "tauri://localhost/")!))
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { print("Native viewer test timed out"); exit(1) }
app.run()
