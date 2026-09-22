import SwiftUI

/// Filled/empty dots showing how many of the 4 passcode digits have been entered —
/// the same visual language as iOS's own passcode prompts (e.g. Photos' Private Album).
struct PasscodeDots: View {
    let filled: Int
    let total = 4

    var body: some View {
        HStack(spacing: 16) {
            ForEach(0..<total, id: \.self) { index in
                ZStack {
                    Circle().fill(index < filled ? Color.primary : Color.clear)
                    Circle().stroke(Color.secondary, lineWidth: 1.5)
                }
                .frame(width: 12, height: 12)
            }
        }
    }
}

/// A native-style circular number pad: 1–9, then 0 with a delete key alongside.
struct NumberPadGrid: View {
    let onDigit: (String) -> Void
    let onDelete: () -> Void

    private let rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]]

    var body: some View {
        VStack(spacing: 22) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 22) {
                    ForEach(row, id: \.self) { digit in
                        NumberPadButton(label: digit) { onDigit(digit) }
                    }
                }
            }
            HStack(spacing: 22) {
                Color.clear.frame(width: 72, height: 72)
                NumberPadButton(label: "0") { onDigit("0") }
                Button(action: onDelete) {
                    Image(systemName: "delete.left")
                        .font(.title2)
                        .frame(width: 72, height: 72)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct NumberPadButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 30))
                .frame(width: 72, height: 72)
                .background(Circle().fill(Color(.tertiarySystemFill)))
        }
        .buttonStyle(.plain)
    }
}
