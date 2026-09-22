import SwiftUI

/// App-level Settings card at the bottom of the home page — Face ID / passcode lock,
/// independent of any cloud connection.
struct SettingsCard: View {
    @ObservedObject private var manager = AppLockManager.shared
    @ObservedObject private var operationQueue = S3OperationQueue.shared
    @State private var showingPasscodeSetup = false
    @State private var showingDisablePasscodeConfirm = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().padding(.leading, 68)
            faceIDRow
            Divider().padding(.leading, 68)
            passcodeRow
            if manager.isPasscodeEnabled, let hint = manager.passcodeHint, !hint.isEmpty {
                Divider().padding(.leading, 68)
                hintRow(hint)
            }
            Divider().padding(.leading, 68)
            queueRow
        }
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
        .shadow(color: .black.opacity(0.08), radius: 12, x: 0, y: 6)
        .sheet(isPresented: $showingPasscodeSetup) {
            PasscodeSetupView(manager: manager)
        }
        .confirmationDialog("Turn off passcode?", isPresented: $showingDisablePasscodeConfirm, titleVisibility: .visible) {
            Button("Turn Off", role: .destructive) { manager.clearPasscode() }
        }
    }

    private var header: some View {
        HStack(spacing: 14) {
            VendorBadge(systemImage: "lock.fill", color: .gray, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text("Settings").font(.title3.weight(.bold))
                Text("Local protection for this app").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16)
    }

    private var faceIDRow: some View {
        HStack(spacing: 14) {
            VendorBadge(systemImage: "faceid", color: .blue, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text("Face ID").fontWeight(.medium)
                if !manager.faceIDAvailable {
                    Text("Not available on this device").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Toggle("", isOn: $manager.isFaceIDEnabled)
                .labelsHidden()
                .disabled(!manager.faceIDAvailable)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var passcodeRow: some View {
        HStack(spacing: 14) {
            VendorBadge(systemImage: "number", color: .orange, size: 34)
            Text("Passcode").fontWeight(.medium)
            Spacer()
            Toggle("", isOn: Binding(
                get: { manager.isPasscodeEnabled },
                set: { newValue in
                    if newValue {
                        showingPasscodeSetup = true
                    } else {
                        showingDisablePasscodeConfirm = true
                    }
                }
            ))
            .labelsHidden()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var queueRow: some View {
        let active = operationQueue.operations.contains { $0.status == .running }
        return NavigationLink(value: HomeRoute.operations) {
            HStack(spacing: 14) {
                VendorBadge(systemImage: active ? "arrow.triangle.2.circlepath" : "list.bullet", color: .green, size: 34)
                Text("Process Queue").fontWeight(.medium).foregroundStyle(.primary)
                Spacer()
                if active {
                    Image(systemName: "circle.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(.green)
                        .symbolEffect(.pulse, isActive: active)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func hintRow(_ hint: String) -> some View {
        HStack(spacing: 14) {
            VendorBadge(systemImage: "lightbulb.fill", color: .yellow, size: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text("Hint").fontWeight(.medium)
                Text(hint).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Change") { showingPasscodeSetup = true }
                .font(.caption)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
