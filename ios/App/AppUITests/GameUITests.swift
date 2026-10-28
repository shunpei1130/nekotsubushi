import XCTest

final class GameUITests: XCTestCase {
    let app = XCUIApplication()
    let names = ["ねこつんつん", "箱をずらせ", "猫パンチ寸止め", "その帽子、いやニャ！", "ほっぺむにむに", "あとちょっとで届くのに"]
    let operations = ["目を閉じている間にタップ", "飛び込む瞬間、箱をスワイプ", "長押しして、パンチの前に離す", "帽子が外れたら、またタップ", "ほっぺを引っぱって、離すだけ", "羽を動かして、つかまるな！"]
    override func setUp() { continueAfterFailure = false; XCUIDevice.shared.orientation = .portrait }
    override func tearDown() { app.terminate() }
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
        for _ in 0..<5 { if card.isHittable { break }; app.swipeUp() }
        card.tap()
        XCTAssertTrue(button("メニューへ").waitForExistence(timeout: 40))
        sleep(2)
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
        app.terminate()
        app.launchArguments=["--ui-testing"]
        let url=Bundle(for:Self.self).url(forResource:"qualifying-history",withExtension:"json")!
        app.launchEnvironment["NEKO_UI_TEST_SAVE"]=try! String(contentsOf:url,encoding:.utf8)
        app.launch()
    }
    func tapVisible(_ title: String) {
        let control=button(title)
        XCTAssertTrue(control.waitForExistence(timeout:20))
        for _ in 0..<4 {if control.isHittable {break}; app.swipeUp()}
        control.tap()
    }
    func test01FreshTouchPauseAndShare() {
        app.launch()
        XCTAssertTrue(button("音と動きの設定").waitForExistence(timeout:40)); photo("fresh-ios-menu")
        enter(1)
        point(1,0.69,0.51).tap()
        XCTAssertTrue(named("成功回数 1 回").waitForExistence(timeout:8))
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
        XCTAssertTrue(app.otherElements.matching(identifier:"neko-native-share-sheet").firstMatch.waitForExistence(timeout:10))
        photo("ios-native-image-share-sheet")
        let close=button("Close")
        if close.exists {close.tap()} else if button("Cancel").exists {button("Cancel").tap()} else {app.swipeDown()}
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
                XCTAssertTrue(app.otherElements.matching(identifier:"neko-native-share-sheet").firstMatch.waitForExistence(timeout:10))
                photo("ios-native-video-share-sheet")
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
    }
}
