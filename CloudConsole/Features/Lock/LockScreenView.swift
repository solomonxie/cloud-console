import SwiftUI

/// Full-screen cover shown while `AppLockManager.isLocked` — blocks the whole app until
/// Face ID or the passcode succeeds.
struct LockScreenView: View {
    @ObservedObject var manager: AppLockManager
    @State private var showingPasscodePad: Bool
    @State private var isAuthenticating = false

    init(manager: AppLockManager) {
        self.manager = manager
        _showingPasscodePad = State(initialValue: !manager.isFaceIDEnabled && manager.isPasscodeEnabled)
    }

    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            if showingPasscodePad {
                PasscodeEntryView(manager: manager, onFallbackToFaceID: manager.isFaceIDEnabled ? { showingPasscodePad = false } : nil)
            } else {
                VStack(spacing: 20) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(.secondary)
                    Text("Cloud Console Locked")
                        .font(.headline)
                    Button {
                        Task { await authenticate() }
                    } label: {
                        Label("Unlock with Face ID", systemImage: "faceid")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isAuthenticating)
                    if manager.isPasscodeEnabled {
                        Button("Use Passcode") { showingPasscodePad = true }
                            .font(.subheadline)
                    }
                }
            }
        }
        .task {
            if !showingPasscodePad { await authenticate() }
        }
    }

    private func authenticate() async {
        isAuthenticating = true
        let success = await manager.authenticateWithFaceID()
        isAuthenticating = false
        if success {
            manager.isLocked = false
        } else if manager.isPasscodeEnabled {
            showingPasscodePad = true
        }
    }
}

struct PasscodeEntryView: View {
    @ObservedObject var manager: AppLockManager
    var onFallbackToFaceID: (() -> Void)?

    @State private var digits = ""
    @State private var showingError = false

    var body: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 12)
            VStack(spacing: 8) {
                Text("Enter Passcode")
                    .font(.headline)
                if let hint = manager.passcodeHint, !hint.isEmpty {
                    Text("Hint: \(hint)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Text(showingError ? "Incorrect passcode" : " ")
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            PasscodeDots(filled: digits.count)
            Spacer(minLength: 12)
            NumberPadGrid(onDigit: append, onDelete: delete)
            if let onFallbackToFaceID {
                Button("Use Face ID Instead", action: onFallbackToFaceID)
                    .font(.subheadline)
            }
            Spacer(minLength: 12)
        }
        .padding(.horizontal, 40)
    }

    private func append(_ digit: String) {
        guard digits.count < 4 else { return }
        showingError = false
        digits += digit
        if digits.count == 4 { verify() }
    }

    private func delete() {
        guard !digits.isEmpty else { return }
        digits.removeLast()
    }

    private func verify() {
        if manager.verify(passcode: digits) {
            manager.isLocked = false
        } else {
            showingError = true
            digits = ""
        }
    }
}
