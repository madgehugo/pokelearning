// Shared by the standalone panel (apps/panel-macos, used by `npm run play`) and
// the Pokélearning app (apps/desktop-macos): a small window that stays on top
// of the game and docks next to mGBA and shows the companion's live view (#/panel).
//
// It follows the mGBA window when you move or resize it. Drag the panel away
// and it stays put; the panel's "Dock" link snaps it back. Clicking in the
// panel doesn't take keyboard focus from the game. Links to Review, Words and
// Games open in your default browser.

import AppKit
import WebKit

/// The emulator's game window in Cocoa coordinates (origin bottom left), if it is on screen.
/// Window positions don't need Screen Recording permission (only titles would).
func emulatorWindowFrame(app: String) -> NSRect? {
  guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
        let mainHeight = NSScreen.screens.first?.frame.height else { return nil }
  let frames: [CGRect] = info.compactMap { w in
    guard (w[kCGWindowOwnerName as String] as? String)?.localizedCaseInsensitiveContains(app) == true,
          (w[kCGWindowLayer as String] as? Int) == 0,
          let bounds = w[kCGWindowBounds as String] as? [String: CGFloat] else { return nil }
    let r = CGRect(x: bounds["X"] ?? 0, y: bounds["Y"] ?? 0, width: bounds["Width"] ?? 0, height: bounds["Height"] ?? 0)
    return r.width > 100 && r.height > 80 ? r : nil
  }
  // mGBA also owns the scripting window: prefer the one shaped like a GBA screen (3:2, plus a title bar).
  let best = frames.min { a, b in
    func score(_ r: CGRect) -> CGFloat { abs((r.height - 28) / r.width - 2.0 / 3.0) }
    return score(a) < score(b)
  }
  guard let r = best else { return nil }
  return NSRect(x: r.minX, y: mainHeight - r.maxY, width: r.width, height: r.height)
}

/// Whether the emulator's window is the topmost normal window on screen (our own panel doesn't
/// count), or there is no emulator window at all yet.
func emulatorIsTopmost(app: String) -> Bool {
  guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return true }
  let me = ProcessInfo.processInfo.processIdentifier
  for w in info { // front to back
    guard (w[kCGWindowLayer as String] as? Int) == 0,
          let bounds = w[kCGWindowBounds as String] as? [String: CGFloat],
          (bounds["Width"] ?? 0) > 100, (bounds["Height"] ?? 0) > 80 else { continue }
    let owner = w[kCGWindowOwnerName as String] as? String ?? ""
    if owner.localizedCaseInsensitiveContains(app) { return true }
    if (w[kCGWindowOwnerPID as String] as? Int32) == me { continue } // our own other windows don't hide it
    return false
  }
  return true // no emulator window on screen (yet)
}

/// Settings for the panel.
struct PanelOptions {
  var url = URL(string: "http://localhost:8766/#/panel")!
  var width: CGFloat = 380
  var app = "mGBA"
}

/// Never takes keyboard focus, so the game keeps getting the keys while you use the panel.
final class FloatingPanel: NSPanel {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

final class PanelController: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  private let options: PanelOptions
  /// Called when the panel window is closed (the standalone panel quits; the app keeps running).
  var onClose: () -> Void = {}
  private let panel: FloatingPanel
  private let web: WKWebView
  private var following = true { didSet { pushDockState() } }
  private var placing = false
  private var lastEmulator: NSRect?
  private var retry: Timer?
  private var closedByUser = false

  init(options: PanelOptions) {
    self.options = options
    panel = FloatingPanel(
      contentRect: NSRect(x: 200, y: 200, width: options.width, height: 600),
      styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel],
      backing: .buffered, defer: false)
    let config = WKWebViewConfiguration()
    web = WKWebView(frame: .zero, configuration: config)
    super.init()
    config.userContentController.add(self, name: "panel")
    panel.title = "Pokélearning"
    panel.level = .floating
    panel.isFloatingPanel = true
    panel.hidesOnDeactivate = false // stays visible while you play
    panel.becomesKeyOnlyIfNeeded = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.minSize = NSSize(width: 280, height: 300)
    panel.delegate = self
    web.navigationDelegate = self
    web.uiDelegate = self
    panel.contentView = web
    panel.orderFrontRegardless()
    web.load(URLRequest(url: options.url))
    Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in
      self?.updateVisibility()
      self?.follow()
    }
    follow()
  }

  /// Show the panel only while the game is the topmost window, so it doesn't stay on top of
  /// other apps. It comes back when you return to the game. This looks at the windows
  /// themselves, front to back, rather than at the frontmost app: our own app is often
  /// "frontmost" (after a dialog, or a click on its Dock icon) with another app's window above the game.
  private func updateVisibility() {
    guard !closedByUser else { return }
    let shouldShow = emulatorIsTopmost(app: options.app)
    if shouldShow && !panel.isVisible { panel.orderFrontRegardless() }
    if !shouldShow && panel.isVisible { panel.orderOut(nil) }
  }

  /// Keep the panel beside the emulator window, right if there's room, else left.
  private func follow() {
    guard following, let emu = emulatorWindowFrame(app: options.app) else { return }
    if let last = lastEmulator, last == emu { return }
    lastEmulator = emu
    let screen = NSScreen.screens.first { $0.frame.intersects(emu) } ?? NSScreen.main ?? NSScreen.screens[0]
    let visible = screen.visibleFrame
    let width = panel.frame.width
    let height = max(emu.height, 420)
    var x = emu.maxX + 6
    if x + width > visible.maxX { x = emu.minX - width - 6 }
    if x < visible.minX { x = visible.maxX - width }
    let y = max(visible.minY, emu.maxY - height)
    placing = true
    panel.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true, animate: false)
    placing = false
  }

  /// Tell the page whether the panel is docked; it only offers "Dock" once you've moved it away.
  private func pushDockState() {
    web.evaluateJavaScript("window.__panelDocked = \(following); window.dispatchEvent(new Event('panel-docked'))")
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { pushDockState() }

  // You moved the panel yourself: stop following until "Dock".
  func windowDidMove(_ notification: Notification) {
    if !placing && panel.isVisible && lastEmulator != nil { following = false }
  }

  func windowWillClose(_ notification: Notification) {
    closedByUser = true
    onClose()
  }

  /// Bring the panel back (after it was closed) and reload its page.
  func show() {
    closedByUser = false
    panel.orderFrontRegardless()
    web.reload()
  }

  /// Snap back next to the emulator window.
  func dock() {
    following = true
    lastEmulator = nil
    follow()
  }

  /// Load the page again, e.g. after the server restarted.
  func reload() {
    web.load(URLRequest(url: options.url))
  }

  // "Dock" in the page
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.body as? String == "dock" { dock() }
  }

  // Links to the website (Review, Words, Games) open in the default browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
    let url = navigationAction.request.url
    let isPanel = url?.host == options.url.host && url?.port == options.url.port && (url?.fragment ?? "").hasPrefix("/panel")
    if navigationAction.navigationType == .linkActivated && !isPanel, let url {
      NSWorkspace.shared.open(url)
      decisionHandler(.cancel)
    } else {
      decisionHandler(.allow)
    }
  }

  // Server not running yet: say so, and try again every two seconds.
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    webView.loadHTMLString("""
      <body style="font: 15px -apple-system, sans-serif; color: #4b566e; background: #eef2f7; padding: 16px">
      <p style="font-weight: 700; color: #1e2433">Waiting for the Pokélearning server…</p>
      <p>Start it with <code>npm run play</code> (or <code>npm start</code>) in the project folder.
      This panel connects as soon as it runs.</p></body>
      """, baseURL: nil)
    retry?.invalidate()
    retry = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in
      guard let self else { return }
      self.web.load(URLRequest(url: self.options.url))
    }
  }
}
