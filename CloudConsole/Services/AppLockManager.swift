import Foundation
import LocalAuthentication
import CryptoKit

/// App-level lock: Face ID and/or a 4-digit passcode, gating the whole app on launch/resume.
/// Independent of any cloud connection's own credentials — this only protects local access
/// to an already-unlocked device, so the passcode is stored as a salted hash, never plaintext.
@MainActor
final class AppLockManager: ObservableObject {
    static let shared = AppLockManager()

    @Published var isFaceIDEnabled: Bool {
        didSet { UserDefaults.standard.set(isFaceIDEnabled, forKey: Self.faceIDKey) }
    }
    @Published var isPasscodeEnabled: Bool {
        didSet { UserDefaults.standard.set(isPasscodeEnabled, forKey: Self.passcodeEnabledKey) }
    }
    @Published private(set) var passcodeHint: String? {
        didSet { UserDefaults.standard.set(passcodeHint, forKey: Self.hintKey) }
    }
    @Published var isLocked: Bool

    private static let faceIDKey = "applock.faceid.enabled"
    private static let passcodeEnabledKey = "applock.passcode.enabled"
    private static let hintKey = "applock.passcode.hint"
    private static let passcodeHashKeychainKey = "applock.passcode.hash"

    var isEnabled: Bool { isFaceIDEnabled || isPasscodeEnabled }

    var faceIDAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    private init() {
        let faceID = UserDefaults.standard.bool(forKey: Self.faceIDKey)
        let passcode = UserDefaults.standard.bool(forKey: Self.passcodeEnabledKey)
        isFaceIDEnabled = faceID
        isPasscodeEnabled = passcode
        passcodeHint = UserDefaults.standard.string(forKey: Self.hintKey)
        isLocked = faceID || passcode
    }

    func lock() {
        guard isEnabled else { return }
        isLocked = true
    }

    func setPasscode(_ passcode: String, hint: String?) {
        KeychainStore.save(Self.hash(passcode), forKey: Self.passcodeHashKeychainKey)
        passcodeHint = (hint?.isEmpty ?? true) ? nil : hint
        isPasscodeEnabled = true
    }

    func clearPasscode() {
        KeychainStore.delete(forKey: Self.passcodeHashKeychainKey)
        passcodeHint = nil
        isPasscodeEnabled = false
    }

    func verify(passcode: String) -> Bool {
        guard let stored = KeychainStore.load(forKey: Self.passcodeHashKeychainKey) else { return false }
        return stored == Self.hash(passcode)
    }

    func authenticateWithFaceID() async -> Bool {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return false }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Unlock Cloud Console")) ?? false
    }

    private static func hash(_ passcode: String) -> String {
        SHA256.hash(data: Data("cloudconsole-applock:\(passcode)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
