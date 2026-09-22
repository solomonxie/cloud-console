import SwiftUI

/// Sheet for creating the app passcode — native-style keypad flow: enter, confirm, then an
/// optional hint, matching iOS's own passcode prompts (e.g. Photos' Private Album).
struct PasscodeSetupView: View {
    @ObservedObject var manager: AppLockManager
    @Environment(\.dismiss) private var dismiss

    private enum Step { case create, confirm, hint }
    @State private var step: Step = .create
    @State private var firstEntry = ""
    @State private var digits = ""
    @State private var errorText: String?
    @State private var hint = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                switch step {
                case .create, .confirm:
                    VStack(spacing: 8) {
                        Text("Passcode").font(.headline)
                        Text(step == .create ? "Enter a 4-digit passcode." : "Re-enter your passcode.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Text(errorText ?? " ")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                    PasscodeDots(filled: digits.count)
                    NumberPadGrid(onDigit: append, onDelete: delete)
                case .hint:
                    VStack(spacing: 8) {
                        Text("Add a Hint").font(.headline)
                        Text("Shown on the lock screen if you forget your passcode. Don't make it the passcode itself.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    TextField("Hint (optional)", text: $hint)
                        .textFieldStyle(.roundedBorder)
                        .padding(.horizontal, 24)
                    Button("Save") {
                        manager.setPasscode(firstEntry, hint: hint)
                        dismiss()
                    }
                    .buttonStyle(.borderedProminent)
                }
                Button("Cancel") { dismiss() }
                    .font(.body)
            }
            .padding(.horizontal, 40)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity)
        }
    }

    private func append(_ digit: String) {
        guard digits.count < 4 else { return }
        errorText = nil
        digits += digit
        guard digits.count == 4 else { return }
        switch step {
        case .create:
            firstEntry = digits
            digits = ""
            step = .confirm
        case .confirm:
            if digits == firstEntry {
                digits = ""
                step = .hint
            } else {
                errorText = "Passcodes didn't match — try again."
                digits = ""
                firstEntry = ""
                step = .create
            }
        case .hint:
            break
        }
    }

    private func delete() {
        guard !digits.isEmpty else { return }
        digits.removeLast()
    }
}
