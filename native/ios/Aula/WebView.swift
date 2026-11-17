// La interfaz de Aula: una vista web que habla con el Mac por el túnel local (http://127.0.0.1:<puerto>). Las cookies
// (la del dispositivo vinculado y la llave del túnel) viven en el almacén de la app; nada sale de 127.0.0.1.
import SwiftUI
import WebKit
#if canImport(UIKit)
import ObjectiveC
#endif

#if canImport(UIKit)
typealias PlatformViewRepresentable = UIViewRepresentable
#else
typealias PlatformViewRepresentable = NSViewRepresentable
#endif

/// Cómo se ve la página: si está en oscuro (el tema de Aula, que puede no ser el del sistema) y el color de su borde de
/// arriba («#rrggbb», con el grano del papel y lo que lo tape, como el velo de un diálogo).
struct PageLook: Equatable {
    /// Es la interfaz de Aula (no la página de vincular).
    var app = false
    let dark: Bool
    let top: String?
}

/// Lo que la interfaz le pide o le cuenta a la app.
struct WebEvents {
    /// No cargó (el túnel se cerró, el Mac se durmió).
    var failed: @MainActor () -> Void = {}
    /// «Abrir otra Aula» (Ajustes → Acerca de).
    var switchAula: @MainActor () -> Void = {}
    /// Cómo se ve la página y si el sistema está en oscuro.
    var look: @MainActor (PageLook, Bool) -> Void = { _, _ in }
    /// Las licencias de lo que lleva la app.
    var licenses: @MainActor () -> Void = {}
    /// Salir de la demostración desde la interfaz.
    var exitDemo: @MainActor () -> Void = {}
    /// La interfaz enseña ella misma el aviso de la demostración (la franja nativa sobra).
    var demoNotice: @MainActor (Bool) -> Void = { _ in }
}

struct WebView: PlatformViewRepresentable {
    /// El túnel de ahora: http://127.0.0.1:<puerto>. Si cambia (al volver de segundo plano), se recarga en el nuevo.
    let base: URL
    var events = WebEvents()

    func makeCoordinator() -> Coordinator { Coordinator(events: events) }

    /// Lo que la interfaz puede pedir a la app (`window.aulaApp`). Lo mismo que en Android (MainActivity.AppBridge):
    /// page(json) cómo se ve (lo manda Shell.js), switchAula(), setCanGoBack(bool) (deslizar desde el borde izquierdo tiene
    /// algo que hacer aunque el historial no lo diga), showLicenses(), exitDemo() y demoNotice(bool).
    private static let appBridge = """
    (() => {
      const post = (m) => window.webkit.messageHandlers.aulaApp.postMessage(m);
      window.aulaApp = {
        page: (json) => post('page:' + json),
        switchAula: () => post('switch'),
        setCanGoBack: (can) => post(can ? 'back:1' : 'back:0'),
        showLicenses: () => post('licenses'),
        exitDemo: () => post('exitDemo'),
        demoNotice: (on) => post(on ? 'notice:1' : 'notice:0')
      };
    })();
    """

    /// Shell.js: que se sienta una app y no una página, y decirle a la app cómo se ve (la misma que en Android).
    private static let shell: String = {
        guard let url = Bundle.main.url(forResource: "Shell", withExtension: "js"), let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return text
    }()

    private func makeView(_ context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        #if canImport(UIKit)
        // las grabaciones de clase se ven dentro de la página, no a pantalla completa por la fuerza
        config.allowsInlineMediaPlayback = true
        #endif
        config.userContentController.addUserScript(WKUserScript(source: Self.appBridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(WeakMessageHandler(context.coordinator), name: "aulaApp")
        #if canImport(UIKit)
        if !Self.shell.isEmpty {
            config.userContentController.addUserScript(WKUserScript(source: Self.shell, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let view = AulaWebView(frame: .zero, configuration: config)
        view.onSystemStyle = { [weak coordinator = context.coordinator] dark in coordinator?.systemChanged(dark) }
        #else
        let view = WKWebView(frame: .zero, configuration: config)
        #endif
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        #if canImport(UIKit)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        // la interfaz ya deja sitio a la muesca y a la barra de inicio (env(safe-area-inset-*)) y se desplaza por dentro
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        view.scrollView.alwaysBounceVertical = false
        // una app, no una página: sin vista previa al mantener pulsado un enlace y sin zoom con los dedos
        view.allowsLinkPreview = false
        view.scrollView.delegate = context.coordinator
        // iOS 26 difumina lo que pasa por debajo de la hora y la batería: la interfaz ya deja ese hueco limpio
        if #available(iOS 26.0, *) {
            view.scrollView.topEdgeEffect.isHidden = true
            view.scrollView.bottomEdgeEffect.isHidden = true
            view.scrollView.leftEdgeEffect.isHidden = true
            view.scrollView.rightEdgeEffect.isHidden = true
        }
        #endif
        context.coordinator.show(base, in: view)
        return view
    }

    #if canImport(UIKit)
    func makeUIView(context: Context) -> WKWebView { makeView(context) }
    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.events = events
        context.coordinator.show(base, in: view)
    }
    #else
    func makeNSView(context: Context) -> WKWebView { makeView(context) }
    func updateNSView(_ view: WKWebView, context: Context) {
        context.coordinator.events = events
        context.coordinator.show(base, in: view)
    }
    #endif

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var events: WebEvents
        private var shown: URL?
        /// Lo último que dijo la página de cómo se ve (se vuelve a contar si el sistema cambia de claro a oscuro).
        private var look: PageLook?
        /// La interfaz de Aula está a la vista: la página entera no se mueve (cada pantalla se desplaza por dentro).
        fileprivate var lockScroll = false

        init(events: WebEvents) {
            self.events = events
        }

        /// Un mensaje de la interfaz, solo de la página de Aula por el túnel (el marco principal de 127.0.0.1).
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "aulaApp", let body = message.body as? String, message.frameInfo.isMainFrame,
                  message.frameInfo.request.url?.host == "127.0.0.1" else { return }
            switch body {
            case "switch": events.switchAula()
            case "licenses": events.licenses()
            case "exitDemo": events.exitDemo()
            case "notice:1", "notice:0": events.demoNotice(body == "notice:1")
            case "back:1", "back:0":
                #if canImport(UIKit)
                (message.webView as? AulaWebView)?.pageCanGoBack = body == "back:1"
                #endif
            default:
                guard body.hasPrefix("page:"), let look = Self.parse(String(body.dropFirst(5))) else { return }
                self.look = look
                #if canImport(UIKit)
                lockScroll = look.app
                message.webView?.scrollView.isScrollEnabled = !look.app
                // cada vez que la página cambia de aspecto se vuelve a mirar el del sistema (no solo al volver a la app)
                (message.webView as? AulaWebView)?.recheckSystem()
                #endif
                events.look(look, systemDark(message.webView))
            }
        }

        /// {"dark":true,"top":["#…","#…",0.25],…} (Shell.js) → cómo se ve.
        static func parse(_ json: String) -> PageLook? {
            guard let data = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let dark = o["dark"] as? Bool else { return nil }
            let top = (o["top"] as? [Any]).flatMap { $0.count > 1 ? $0[1] as? String : nil }
            return PageLook(app: o["app"] as? Bool ?? false, dark: dark, top: top.flatMap { $0.count == 7 && $0.hasPrefix("#") ? $0 : nil })
        }

        /// El sistema pasó a claro u oscuro: la app vuelve a decidir si sigue a la página o al sistema.
        func systemChanged(_ dark: Bool) {
            if let look { events.look(look, dark) }
        }

        private func systemDark(_ view: WKWebView?) -> Bool {
            #if canImport(UIKit)
            if let web = view as? AulaWebView { return web.systemDark }
            return UITraitCollection.current.userInterfaceStyle == .dark
            #else
            return NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            #endif
        }

        /// Carga la interfaz en el túnel `base` (una sola vez por túnel), en la pantalla en la que estaba: la interfaz
        /// apunta su pantalla en el fragmento de la dirección («#…»).
        func show(_ base: URL, in view: WKWebView) {
            guard shown != base, var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return }
            shown = base
            #if canImport(UIKit)
            // la página nueva dirá si tiene adónde volver
            (view as? AulaWebView)?.pageCanGoBack = false
            #endif
            // la consulta de la dirección se conserva («?demo=1» en la demostración)
            parts.path = "/"
            parts.percentEncodedFragment = view.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.percentEncodedFragment }
            if let url = parts.url { view.load(URLRequest(url: url)) }
        }

        /// ¿Es una dirección del túnel? (lo único que se abre dentro de la app).
        private func isTunnel(_ url: URL) -> Bool {
            url.scheme == "http" && url.host == "127.0.0.1" && url.port == shown?.port
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.cancel) }
            if isTunnel(url) || url.scheme == "about" || url.scheme == "blob" { return decisionHandler(.allow) }
            // un enlace de fuera (una fuente citada, una página): en el navegador del sistema, y solo si es web
            if action.targetFrame?.isMainFrame != false, url.scheme == "https" || url.scheme == "http" { openOutside(url) }
            decisionHandler(.cancel)
        }

        /// Enlaces que piden ventana nueva: fuera, no dentro.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if isTunnel(url) { webView.load(action.request) } else if url.scheme == "https" || url.scheme == "http" { openOutside(url) }
            }
            return nil
        }

        private func openOutside(_ url: URL) {
            #if canImport(UIKit)
            UIApplication.shared.open(url)
            #else
            NSWorkspace.shared.open(url)
            #endif
        }

        /// Una página nueva: ella dirá si tiene adónde volver (la de vincular, no).
        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            #if canImport(UIKit)
            (webView as? AulaWebView)?.pageCanGoBack = false
            // hasta que la página diga que es la interfaz de Aula, se desplaza como cualquier página
            lockScroll = false
            webView.scrollView.isScrollEnabled = true
            #endif
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            failed(error)
        }

        private func failed(_ error: Error) {
            // cancelar una carga para empezar otra no es un fallo
            if (error as NSError).domain == NSURLErrorDomain, (error as NSError).code == NSURLErrorCancelled { return }
            shown = nil
            events.failed()
        }

        /// iOS cerró el proceso de la página (memoria): se vuelve a cargar.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }
    }
}

#if canImport(UIKit)
extension WebView.Coordinator: UIScrollViewDelegate {
    /// La página ya pide que no haya zoom; por si WebKit lo deja pasar, el gesto de dos dedos se apaga aquí.
    func scrollViewWillBeginZooming(_ scrollView: UIScrollView, with view: UIView?) {
        scrollView.pinchGestureRecognizer?.isEnabled = false
    }

    /// Con la interfaz de Aula, la página entera nunca se desplaza: WebKit la movía para enseñar el campo que se escribe
    /// (y entonces se podía arrastrar toda la app). La vista web ya acaba encima del teclado, así que el campo está a la
    /// vista; cada pantalla se desplaza en sus propias zonas. La página de vincular sí puede (un iPhone pequeño con teclado).
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        if lockScroll, scrollView.contentOffset != .zero { scrollView.contentOffset = .zero }
    }
}

/// La vista web a toda pantalla. SwiftUI le quita los márgenes seguros a una vista que los ignora, y la página, que deja
/// sitio a la hora y la batería con env(safe-area-inset-*), se quedaba debajo. Aquí se le dicen los de verdad: los de la
/// ventana, descontando lo que ya tapa otra cosa (la barra de la demostración o el teclado).
final class AulaWebView: WKWebView {
    private var told: UIEdgeInsets = .zero
    /// El sistema está en oscuro. La vista web lo sigue siempre (su prefers-color-scheme), aunque la app siga el tema de
    /// Aula: si no, con Aula en «como el sistema» nunca se enteraría de un cambio.
    private(set) var systemDark = false
    var onSystemStyle: (@MainActor (Bool) -> Void)?
    private var sceneWatch: (scene: UIWindowScene, token: any UITraitChangeRegistration)?
    /// La interfaz tiene adónde volver: se puede deslizar desde el borde izquierdo, como en las apps del iPhone. Lo dice
    /// ella (setCanGoBack) o su historial: mientras tiene algo que deshacer deja una entrada de guarda (deviceBack.ts).
    var pageCanGoBack = false {
        didSet { updateSwipe() }
    }
    private var edgeSwipe: UIScreenEdgePanGestureRecognizer?
    private var historyWatch: NSKeyValueObservation?
    /// «Atrás» dentro de la interfaz: se le pregunta primero (window.__aulaBack dice si lo atendió).
    private static let askBack = "(() => { if (typeof window.__aulaBack === 'function') return !!window.__aulaBack();"
        + " if (window.aulaNav && typeof window.aulaNav.back === 'function') { window.aulaNav.back(); return true } return false })()"

    override var safeAreaInsets: UIEdgeInsets {
        guard let window else { return super.safeAreaInsets }
        let frame = convert(bounds, to: window)
        var safe = window.safeAreaInsets
        // en el iPad apaisado a pantalla completa la ventana dice 10 pt arriba y la barra de estado mide unos 24
        if let bar = window.windowScene?.statusBarManager, !bar.isStatusBarHidden { safe.top = max(safe.top, bar.statusBarFrame.height) }
        return UIEdgeInsets(
            top: max(0, safe.top - frame.minY),
            left: max(0, safe.left - frame.minX),
            bottom: max(0, safe.bottom - (window.bounds.maxY - frame.maxY)),
            right: max(0, safe.right - (window.bounds.maxX - frame.maxX))
        )
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        retell()
        watchSystemStyle()
        hideFormAccessory()
        if edgeSwipe == nil, window != nil {
            let swipe = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(swipedBack(_:)))
            swipe.edges = .left
            addGestureRecognizer(swipe)
            edgeSwipe = swipe
            historyWatch = observe(\.canGoBack, options: [.initial, .new]) { view, _ in
                MainActor.assumeIsolated { view.updateSwipe() }
            }
            // el teclado, también para la interfaz (html.ime-open: keyboard.ts aparta las pestañas mientras se escribe)
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
            NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
            // y por si acaso, también al volver a la app
            NotificationCenter.default.addObserver(self, selector: #selector(becameActive), name: UIApplication.didBecomeActiveNotification, object: nil)
        }
        updateSwipe()
    }

    private func updateSwipe() {
        edgeSwipe?.isEnabled = pageCanGoBack || sameAulaBehind
    }

    /// ¿Lo de atrás en el historial es esta misma interfaz? (no la de un túnel anterior, en otro puerto).
    private var sameAulaBehind: Bool {
        guard canGoBack, let back = backForwardList.backItem?.url, let now = url else { return false }
        return back.host == now.host && back.port == now.port && back.scheme == now.scheme
    }

    private var imeOpen = false

    @objc private func keyboardChanged(_ note: Notification) {
        var open = false
        if note.name != UIResponder.keyboardWillHideNotification, let window,
           let frame = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue {
            // un teclado de verdad, no solo la barra de atajos de un teclado físico
            open = window.bounds.intersection(window.convert(frame, from: nil)).height > 150
        }
        guard open != imeOpen else { return }
        imeOpen = open
        evaluateJavaScript("document.documentElement && document.documentElement.classList.toggle('ime-open', \(open)); void 0", completionHandler: nil)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        retell()
    }

    /// WebKit vuelve a leer los márgenes cuando se le avisa de que cambiaron.
    private func retell() {
        let now = safeAreaInsets
        guard now != told else { return }
        told = now
        safeAreaInsetsDidChange()
    }

    /// El tema del sistema se lee de la escena (la ventana puede llevar el de Aula) y se sigue al cambiar.
    private func watchSystemStyle() {
        guard let scene = window?.windowScene else {
            if let watch = sceneWatch { watch.scene.unregisterForTraitChanges(watch.token) }
            sceneWatch = nil
            return
        }
        guard sceneWatch?.scene !== scene else { return }
        if let watch = sceneWatch { watch.scene.unregisterForTraitChanges(watch.token) }
        let token = scene.registerForTraitChanges([UITraitUserInterfaceStyle.self]) { [weak self] (scene: UIWindowScene, _: UITraitCollection) in
            self?.followSystem(scene)
        }
        sceneWatch = (scene, token)
        followSystem(scene)
    }

    private func followSystem(_ scene: UIWindowScene) {
        // el tema de la app va en la ventana (RootView, WindowStyle), así que la escena dice el del sistema; si algo pusiera
        // uno en la escena, valdría el de la pantalla. Leer un tema impuesto ahí hacía un bucle (la app seguía a la página,
        // la vista web a la app, la página a la vista web…) que dejaba la app en blanco y gastando CPU al cambiar a oscuro
        let imposed = scene.traitOverrides.contains(UITraitUserInterfaceStyle.self)
        let dark = (imposed ? scene.screen.traitCollection : scene.traitCollection).userInterfaceStyle == .dark
        overrideUserInterfaceStyle = dark ? .dark : .light
        guard dark != systemDark else { return }
        systemDark = dark
        onSystemStyle?(dark)
    }

    @objc private func becameActive() {
        recheckSystem()
    }

    /// Vuelve a leer el tema del sistema (la app pinta lo nativo en la ventana, así que la escena lo dice siempre).
    func recheckSystem() {
        if let scene = window?.windowScene { followSystem(scene) }
    }

    @objc private func swipedBack(_ swipe: UIScreenEdgePanGestureRecognizer) {
        guard swipe.state == .ended, swipe.translation(in: self).x > 72 || swipe.velocity(in: self).x > 600 else { return }
        // primero la interfaz; si no tenía nada que deshacer, su historial (solo el de esta misma Aula)
        evaluateJavaScript(Self.askBack) { [weak self] handled, _ in
            guard let self, (handled as? Bool) != true, self.sameAulaBehind else { return }
            self.goBack()
        }
    }

    /// Sin la barra de formulario de Safari (‹ › ✓) encima del teclado: la interfaz ya tiene sus botones, y la barra se
    /// quedaba pegada abajo cuando un campo dejaba de poder escribirse con el teclado abierto. La vista que recibe el
    /// teclado pasa a una subclase suya que no da barra (solo cambia `inputAccessoryView`).
    private func hideFormAccessory() {
        guard let content = scrollView.subviews.first(where: { NSStringFromClass(type(of: $0)).hasPrefix("WKContent") }) else { return }
        let base: AnyClass = type(of: content)
        let baseName = NSStringFromClass(base)
        guard !baseName.hasSuffix("_AulaNoBar") else { return }
        let name = baseName + "_AulaNoBar"
        var quiet: AnyClass? = NSClassFromString(name)
        if quiet == nil, let made = objc_allocateClassPair(base, name, 0) {
            let none: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
            class_addMethod(made, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(none), "@@:")
            objc_registerClassPair(made)
            quiet = made
        }
        if let quiet { object_setClass(content, quiet) }
    }
}

/// La barra de estado de ahora (alto 0 si está oculta).
@MainActor
enum StatusBar {
    static var height: CGFloat {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        guard let bar = scene?.statusBarManager, !bar.isStatusBarHidden else { return 0 }
        return bar.statusBarFrame.height
    }
}
#endif

/// El controlador de contenido guarda su manejador con fuerza: este intermediario evita que la vista web y su coordinador se
/// sujeten el uno al otro para siempre.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
