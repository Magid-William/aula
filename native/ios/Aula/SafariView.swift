// La página de inicio de sesión de Tailscale, dentro de la app (SFSafariViewController) y no en Safari: el
// estudiante no sale de Aula, y las passkeys y «Iniciar sesión con Apple» siguen funcionando. Solo existe en iOS (en
// macOS, donde _verify/verify.sh compila la app, se abre en el navegador).
#if canImport(UIKit)
import SafariServices
import SwiftUI

struct SafariView: UIViewControllerRepresentable {
    let url: URL
    /// El estudiante la cerró con su botón.
    let onClose: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onClose: onClose) }

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        config.barCollapsingEnabled = true
        let safari = SFSafariViewController(url: url, configuration: config)
        safari.dismissButtonStyle = .close
        safari.preferredControlTintColor = UIColor(named: "AccentColor")
        safari.delegate = context.coordinator
        return safari
    }

    func updateUIViewController(_ safari: SFSafariViewController, context: Context) {}

    // SafariServices no marca su delegado como del hilo principal, pero UIKit siempre lo llama desde él
    @MainActor
    final class Coordinator: NSObject, @preconcurrency SFSafariViewControllerDelegate {
        let onClose: () -> Void
        init(onClose: @escaping () -> Void) { self.onClose = onClose }
        func safariViewControllerDidFinish(_ controller: SFSafariViewController) { onClose() }
    }
}
#endif
