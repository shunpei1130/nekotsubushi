import UIKit
import WebKit
import Capacitor

final class GameViewController: CAPBridgeViewController {
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SocialVideoPlugin())
    }

    override func present(_ viewControllerToPresent: UIViewController, animated flag: Bool, completion: (() -> Void)? = nil) {
        if viewControllerToPresent is UIActivityViewController {
            viewControllerToPresent.view.accessibilityIdentifier = "neko-native-share-sheet"
        }
        super.present(viewControllerToPresent, animated: flag, completion: completion)
    }

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        #if DEBUG
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
        return configuration
    }
}
