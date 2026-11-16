# Install Aula

<p align="right"><b>English</b> · <a href="INSTALL.es.md">Español</a></p>

Download the file for your system from the [latest release](https://github.com/luumlabs/aula/releases/latest):

| System | File | First launch |
| --- | --- | --- |
| macOS 13 or later (Apple Silicon and Intel) | `Aula-<version>-mac.dmg` | Open the .dmg and drag Aula to *Applications*. Aula isn't notarized by Apple yet, so macOS asks you to confirm the first time. On macOS 15 or later, try to open it, then go to *System Settings → Privacy & Security* and click *Open Anyway*. On macOS 13 and 14, right-click Aula and choose *Open*. |
| Windows 10 and 11 (x64 and ARM, one installer) | `Aula-Setup-<version>.exe` | Run the installer (it doesn't need admin rights). If SmartScreen shows up, click *More info → Run anyway*. Aula isn't code-signed yet. |
| Linux x64 | `Aula-<version>-linux-x86_64.AppImage` or `Aula-<version>-linux-amd64.deb` | AppImage: make it executable (`chmod +x Aula-*.AppImage`) and open it. Debian or Ubuntu: `sudo apt install ./Aula-<version>-linux-amd64.deb`. |
| Linux ARM64 | `Aula-<version>-linux-arm64.AppImage` | Make it executable (`chmod +x`) and open it. |
| Android 8 or later (phones and tablets) | `Aula-<version>-android.apk` | Open it on your phone and allow installing from that app when Android asks. It is a window to Aula on your Mac or on [a server of your own](SERVER.md): see [Devices](DEVICES.md). |

> **Updating from 0.1.x:** install the current version by hand this one time (download it here and install it over
> your copy; your courses and settings stay). Aula 0.1.x will say the new version's signature isn't valid: since 0.2.0
> Aula is signed with new keys, because the old ones were lost. From 0.2.0 on, Aula updates itself again. On a Mac,
> macOS asks once more for permission to use Aula's saved keys.

On Linux you need a 64-bit distribution with glibc. Install GNOME Keyring or KWallet too, or Aula has to store your
keys unencrypted.

The first time you open Aula it asks your name, helps you [pick an AI](../README.md#pick-an-ai) and, if you want,
connects your study platform. Your library starts with two example courses, so you can try everything before making
your own.

## Updates

Aula looks for a new version when it starts and every six hours. It downloads it in the background, checks its
signature and installs it when you quit (or when you click *Restart to update* in the sidebar). On macOS, keep Aula in
*Applications* for this to work; if a new version doesn't start, Aula goes back to the previous one. The AppImage
updates itself too. The `.deb` doesn't: Aula tells you when a new version is out, and you
download its `.deb` from the [releases](https://github.com/luumlabs/aula/releases) and install it the same way.

## Troubleshooting

| Problem | What to do |
|---|---|
| macOS can't verify the developer, or there's no *Open* button | See the macOS row above. On macOS 15 or later, *Open Anyway* only shows up in *Privacy & Security* after you've tried to open Aula once. |
| macOS says the app is damaged | Move Aula to *Applications* and try again. If it still won't open, run `xattr -dr com.apple.quarantine /Applications/Aula.app` in Terminal. |
| macOS doesn't install an update | Check that Aula is in *Applications*, not in *Downloads* or running from the .dmg. *Settings → About* says what went wrong and lets you try again or download the update. |
| The AppImage doesn't start | Make it executable (`chmod +x`). It needs FUSE 2: `sudo apt install libfuse2` (on Ubuntu 24.04 and later, `libfuse2t64`). |
| Ubuntu 23.10 or later, with the AppImage | Ubuntu restricts the user namespaces that Chromium's sandbox needs, so the AppImage starts with that sandbox turned off. Aula still works, but the pages it opens (your study platform, for example) are less isolated. On x64, use the `.deb` instead: it keeps the sandbox on by installing the AppArmor profile Ubuntu needs. |
| Aula can't find `claude` or `codex` | Install the CLI and open it once in a terminal to sign in. After that, *Settings → Your AI* finds it. For ChatGPT, *Connect with ChatGPT* can also download the official Codex for you. |
| A course stopped at a usage limit | Nothing is lost. Open it and press *Resume* when your limit renews, or keep what's already there. |
| *Settings → About* says your keys aren't encrypted | On Linux without GNOME Keyring or KWallet your system can't encrypt them. Install one and sign in again. |
| Anything else | [Open an issue](https://github.com/luumlabs/aula/issues/new/choose). |
