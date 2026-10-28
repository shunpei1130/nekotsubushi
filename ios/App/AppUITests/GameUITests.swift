import XCTest

final class GameUITests: XCTestCase {
    let app = XCUIApplication()
    let names = ["ねこつんつん", "箱をずらせ", "猫パンチ寸止め", "その帽子、いやニャ！", "ほっぺむにむに", "あとちょっとで届くのに"]
    let operations = ["目を閉じている間にタップ", "飛び込む瞬間、箱をスワイプ", "長押しして、パンチの前に離す", "帽子が外れたら、またタップ", "ほっぺを引っぱって、離すだけ", "羽を動かして、つかまるな！"]
    override func setUp() { continueAfterFailure = false }
    override func tearDown() {
        if (testRun?.failureCount ?? 0) > 0 && app.state == .runningForeground {
            print("NATIVE FAILURE HIERARCHY\n" + app.debugDescription)
            photo("native-failure")
        }
        stopApp()
    }
    func stopApp() {
        guard app.state != .notRunning else { return }
        // SpringBoard can refuse a foreground termination during a remote
        // share-extension transition. Finish sharing, then background first.
        XCUIDevice.shared.press(.home)
        app.terminate()
        XCTAssertTrue(app.wait(for:.notRunning,timeout:10))
    }
    func button(_ title: String) -> XCUIElement { app.buttons.matching(identifier:title).firstMatch }
    func named(_ value: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", value)).firstMatch
    }
    func photo(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    func enter(_ mode: Int) {
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", names[mode-1] + "。")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 40))
        XCTAssertFalse(card.label.contains("未解放"),"The explicit Debug precondition must be installed before testing locked modes")
        for _ in 0..<5 { if card.isHittable { break }; app.swipeUp() }
        card.tap()
        XCTAssertTrue(button("メニューへ").waitForExistence(timeout: 40))
        let loading=named("猫がおめかし中…")
        let ready=XCTNSPredicateExpectation(predicate:NSPredicate(format:"exists == false"),object:loading)
        XCTAssertEqual(XCTWaiter.wait(for:[ready],timeout:40),.completed,"Game textures must finish loading")
        XCTAssertFalse(named("猫が、かくれんぼ中です。").exists,"Native game assets failed to load")
    }
    func point(_ mode: Int, _ x: Double, _ y: Double) -> XCUICoordinate {
        let stage = named(names[mode-1] + "。" + operations[mode-1])
        if stage.exists && stage.frame.height > 200 { return stage.coordinate(withNormalizedOffset: CGVector(dx:x,dy:y)) }
        // Native safe area + navigation + task strip; only a fallback for
        // WebKit versions that don't expose role=application as an element.
        let frame=app.frame
        let top=button("メニューへ").frame.maxY + 80
        let height=frame.height-top-34
        let width=min(frame.width,height*941/1672)
        return app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx:(frame.width-width)/2+x*width,dy:top+y*height))
    }
    func launchUnlocked() {
        stopApp()
        app.launchArguments=["--ui-testing"]
        let url=Bundle(for:Self.self).url(forResource:"qualifying-history",withExtension:"json")!
        app.launchEnvironment["NEKO_UI_TEST_SAVE"]=try! String(contentsOf:url,encoding:.utf8)
        app.launch()
        let proof=app.descendants(matching:.any).matching(NSPredicate(format:"label CONTAINS %@","全6ステージ、クリア！")).firstMatch
        XCTAssertTrue(proof.waitForExistence(timeout:60),"The simulator fixture did not load")
    }
    func tapVisible(_ title: String) {
        let control=button(title)
        XCTAssertTrue(control.waitForExistence(timeout:20))
        let dialog=app.otherElements.matching(NSPredicate(format:"label CONTAINS %@","web dialog")).firstMatch
        let screen=app.frame.insetBy(dx:0,dy:100)
        let visible=dialog.exists ? dialog.frame.insetBy(dx:6,dy:12).intersection(screen) : screen
        // WebKit may report clipped offscreen buttons as hittable. Keep the
        // whole control inside the dialog's visible central screen area.
        for _ in 0..<8 {
            let bounds=control.frame
            if control.isHittable && bounds.minY >= visible.minY && bounds.maxY <= visible.maxY {break}
            if bounds.minY < visible.minY {app.swipeDown()} else {app.swipeUp()}
        }
        XCTAssertGreaterThanOrEqual(control.frame.minY,visible.minY)
        XCTAssertLessThanOrEqual(control.frame.maxY,visible.maxY)
        control.tap()
    }
    func assertNativeShare() {
        // Verify actual OS activities. UIActivityViewController's root view
        // identifier is not necessarily exposed by iOS accessibility.
        // None of these labels occurs in the game's HTML share dialog.
        let controls=["AirDrop","Copy","コピー","Save Video","ビデオを保存","Save Image","Save to Files","ファイルに保存","Close","Cancel"]
        let activity=app.descendants(matching:.any).matching(NSPredicate(format:"identifier == %@ OR label IN %@","ActivityListView",controls)).firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout:20),"The native activity sheet must expose a real OS share control")
    }
    func dismissNativeShare() {
        let cancelled=named("いつでも、また送れます。")
        // The iPad popover dismisses on its backdrop. On iPhone the compact
        // activity sheet has no Close button: drag its header, not the page
        // behind it (a whole-app swipe can start above the sheet).
        app.coordinate(withNormalizedOffset:CGVector(dx:0.1,dy:0.15)).tap()
        if !cancelled.waitForExistence(timeout:3) {
            for _ in 0..<3 {
                let start=app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.64))
                let end=app.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.98))
                start.press(forDuration:0.1,thenDragTo:end)
                if cancelled.waitForExistence(timeout:5) {break}
            }
        }
        XCTAssertTrue(cancelled.waitForExistence(timeout:10),"Native cancellation must return to the game before the next round")
        button("閉じる").tap()
    }
    func test01FreshTouchPauseAndShare() {
        app.launchArguments=["--ui-testing"]
        app.launch()
        XCTAssertTrue(button("音と動きの設定").waitForExistence(timeout:40)); photo("fresh-ios-menu")
        enter(1)
        point(1,0.69,0.51).tap()
        // This hint is hidden only after a successful tap starts the game.
        // WebKit does not consistently expose a live status's aria-label.
        let started=XCTNSPredicateExpectation(predicate:NSPredicate(format:"exists == false"),object:named("猫をタップして、はじめる"))
        XCTAssertEqual(XCTWaiter.wait(for:[started],timeout:10),.completed,"The real touch must start the clock")
        button("一時停止").tap()
        XCTAssertTrue(named("ひと休み中。").waitForExistence(timeout:5))
        button("つづける").tap()
        XCUIDevice.shared.orientation = .landscapeLeft; sleep(1); photo("ios-landscape"); XCUIDevice.shared.orientation = .portrait
        if button("つづける").exists {button("つづける").tap()}
        XCTAssertTrue(named("いい、ひまつぶし。").waitForExistence(timeout:45))
        app.swipeUp()
        XCTAssertTrue(button("Xで共有").exists)
        XCTAssertTrue(button("Instagramで共有").exists)
        tapVisible("Instagramで共有")
        XCTAssertTrue(named("画像の用意ができました。共有先からInstagramを選んでください。").waitForExistence(timeout:30))
        tapVisible("文章をコピー")
        XCTAssertTrue(named("投稿用の文章をコピーしました。").waitForExistence(timeout:5))
        tapVisible("共有先からInstagramを選ぶ")
        assertNativeShare()
        photo("ios-native-image-share-sheet")
        dismissNativeShare()
    }
    func test02AllSixResultsAndTikTokMovie() {
        for mode in 1...6 {
            launchUnlocked(); enter(mode); photo("ios-game-\(mode)")
            if mode == 5 { button("おわる").tap() }
            else if mode == 3 { point(mode,0.5,0.51).press(forDuration:0.6) }
            else if mode == 6 { point(mode,0.90,0.18).press(forDuration:0.3) }
            else {point(mode,mode==2 ? 0.5:0.69,mode==2 ? 0.63:0.51).tap()}
            let title=mode==5 ? "むにむに、おしまい。" : mode==3 ? "寸止め、成功！" : mode==6 ? "つかまえたニャ！" : "いい、ひまつぶし。"
            XCTAssertTrue(named(title).waitForExistence(timeout:45),"mode \(mode) result")
            app.swipeUp()
            XCTAssertTrue(button("TikTokで共有").exists,"mode \(mode) share")
            XCTAssertTrue(button("Xで共有").exists); XCTAssertTrue(button("Instagramで共有").exists)
            photo("ios-result-\(mode)")
            if mode == 5 {
                tapVisible("TikTokで共有")
                XCTAssertTrue(named("縦動画ができました。共有先からTikTokを選んでください。").waitForExistence(timeout:60))
                photo("ios-tiktok-video-ready")
                tapVisible("共有先からTikTokを選ぶ")
                assertNativeShare()
                photo("ios-native-video-share-sheet")
                dismissNativeShare()
            }
        }
    }
    func test03TabletLayout() {
        launchUnlocked()
        XCTAssertTrue(button("音と動きの設定").waitForExistence(timeout:40))
        XCTAssertGreaterThanOrEqual(app.frame.width,700)
        photo("ios-ipad-menu")
        enter(5); button("おわる").tap()
        XCTAssertTrue(named("むにむに、おしまい。").waitForExistence(timeout:10))
        app.swipeUp();tapVisible("Instagramで共有")
        XCTAssertTrue(named("画像の用意ができました。共有先からInstagramを選んでください。").waitForExistence(timeout:30))
        photo("ios-ipad-share")
        tapVisible("共有先からInstagramを選ぶ")
        assertNativeShare()
        photo("ios-ipad-native-share-sheet")
        dismissNativeShare()
    }
}
