import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ParleyBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Capacitor's bridge view controller, plus recovery from a blank web view. The app shows the server's web client; when
/// iOS kills the web view's process in the background Capacitor reloads it, and if that load fails (offline, or the
/// network not back yet) nothing retries and the screen stays white until the app is force-quit. Here a failed load of
/// the server shows the bundled "can't reach Parley" page, which keeps retrying, and coming back to the foreground with
/// a dead or empty web view starts it again.
class ParleyBridgeViewController: CAPBridgeViewController {
    private var recovery: NavigationRecovery?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        if let webView = webView, let original = webView.navigationDelegate {
            // navigationDelegate is weak: the proxy is kept here.
            let proxy = NavigationRecovery(forwardingTo: original) { [weak self] in self?.showOffline() }
            recovery = proxy
            webView.navigationDelegate = proxy
        }
        NotificationCenter.default.addObserver(self, selector: #selector(checkWebView), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    /// The bundled page that waits for the server and goes back in by itself.
    private func showOffline() {
        guard let webView = webView, let local = bridge?.config.localURL else { return }
        webView.load(URLRequest(url: local.appendingPathComponent("error.html")))
    }

    /// The bundled connect screen, which goes straight back to the last server.
    private func restart() {
        guard let webView = webView, let start = bridge?.config.appStartServerURL else { return }
        webView.load(URLRequest(url: start))
    }

    /// Back in front: start again when the web view's process is gone (no page, or it can't run script) or the web
    /// client is showing nothing (its root emptied by a crash).
    @objc private func checkWebView() {
        guard let webView = webView else { return }
        guard webView.url != nil else { restart(); return }
        if webView.isLoading { return }
        let probe = "(function () { var r = document.getElementById('root'); return r ? r.childElementCount : (document.body ? document.body.childElementCount : 0) })()"
        webView.evaluateJavaScript(probe) { [weak self] result, error in
            let shown = (result as? NSNumber)?.intValue ?? 0
            if error != nil || shown <= 0 { self?.restart() }
        }
    }
}

/// Stands in as the web view's navigation delegate: a failed load of a server page shows the offline page; every call
/// (including those) also goes to Capacitor's own handler, which keeps doing its work.
final class NavigationRecovery: NSObject, WKNavigationDelegate {
    private weak var original: WKNavigationDelegate?
    private let onFailure: () -> Void

    init(forwardingTo original: WKNavigationDelegate, onFailure: @escaping () -> Void) {
        self.original = original
        self.onFailure = onFailure
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (original?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if original?.responds(to: aSelector) == true { return original }
        return super.forwardingTarget(for: aSelector)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        original?.webView?(webView, didFail: navigation, withError: error)
        recover(webView, error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        original?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        recover(webView, error)
    }

    private func recover(_ webView: WKWebView, _ error: Error) {
        let e = error as NSError
        // A navigation replaced by another, or handed off (a download, a link opened elsewhere): not a failure.
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return }
        // Only server pages: the bundled pages failing must not loop back to the offline page.
        let failing = (e.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url
        guard let scheme = failing?.scheme, scheme == "http" || scheme == "https" else { return }
        onFailure()
    }
}
