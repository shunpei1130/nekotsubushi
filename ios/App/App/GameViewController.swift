import UIKit
import WebKit
import Capacitor

final class GameViewController: CAPBridgeViewController {
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SocialVideoPlugin())
    }

    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        // Capacitor replaces the content controller after webViewConfiguration.
        // Install scripts here, after that replacement and before navigation.
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing") {
            NSLog("neko-ui-test: custom game controller loaded; fixture supplied: %@", ProcessInfo.processInfo.environment["NEKO_UI_TEST_SAVE"] == nil ? "no" : "yes")
            configuration.userContentController.add(UIErrorLogger(), name: "nekoUIError")
            let logger = """
            const report = value => window.webkit.messageHandlers.nekoUIError.postMessage(String(value));
            const original = console.error;
            console.error = (...args) => { report(args.map(x => x?.stack || x?.message || String(x)).join(' ')); original(...args); };
            addEventListener('error', e => report(e.error?.stack || e.message));
            addEventListener('unhandledrejection', e => report(e.reason?.stack || e.reason));
            let downAt = 0;
            addEventListener('pointerdown', e => { downAt = e.timeStamp; }, true);
            addEventListener('pointerup', e => setTimeout(() => {
                const control = e.target?.closest?.('button');
                if (control) report('BUTTON ' + JSON.stringify({mode:control.dataset.mode,action:control.dataset.action,x:e.clientX,y:e.clientY,trusted:e.isTrusted}));
                const s = window.__game?.snapshot();
                if (s) report('INPUT ' + JSON.stringify({mode:s.mode,score:s.score,status:s.status,elapsed:s.elapsed,gestureMs:e.timeStamp-downAt,queueMs:performance.now()-e.timeStamp}));
            }, 0), true);
            """
            configuration.userContentController.addUserScript(WKUserScript(source: logger, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // Simulator integration fixtures are available only in Debug builds,
        // require an explicit XCTest launch argument, and never ship in Release.
        if ProcessInfo.processInfo.arguments.contains("--ui-testing"),
           let fixture = ProcessInfo.processInfo.environment["NEKO_UI_TEST_SAVE"],
           let data = try? JSONSerialization.data(withJSONObject: [fixture]),
           let encoded = String(data: data, encoding: .utf8) {
            let source = "try { if (!sessionStorage.getItem('neko-native-test-seeded')) { localStorage.setItem('nekotsubushi:v2', \(encoded)[0]); sessionStorage.setItem('neko-native-test-seeded','1'); } } catch {}"
            configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #endif
        return super.webView(with: frame, configuration: configuration)
    }
}

#if DEBUG
private final class UIErrorLogger: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        NSLog("neko-ui-log: %@", String(describing: message.body))
    }
}
#endif
