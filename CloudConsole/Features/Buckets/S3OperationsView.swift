import SwiftUI

struct S3OperationsView: View {
    @ObservedObject var queue: S3OperationQueue

    var body: some View {
        Group {
            if queue.operations.isEmpty {
                ContentUnavailableView("No operations", systemImage: "checkmark.circle", description: Text("Deletes, copies, and renames you run will show up here — and keep going if you leave the app."))
            } else {
                List {
                    ForEach(queue.operations) { operation in
                        OperationRow(operation: operation, queue: queue)
                    }
                }
            }
        }
        .navigationTitle("Operations")
        .toolbar {
            if queue.operations.contains(where: { $0.isFinished }) {
                ToolbarItem(placement: .primaryAction) {
                    Button("Clear Finished") { queue.clearFinished() }
                }
            }
        }
    }
}

private struct OperationRow: View {
    let operation: S3Operation
    let queue: S3OperationQueue

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Text(operation.label)
                    .lineLimit(2)
                Spacer()
                statusBadge
            }
            if !operation.items.isEmpty {
                ProgressView(value: Double(operation.completedCount), total: Double(operation.items.count))
                Text("\(operation.completedCount) / \(operation.items.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Text("Preparing…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let errorMessage = operation.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            if operation.status == .failed {
                Button("Retry") { queue.retry(operation.id) }
                    .font(.caption)
            }
        }
        .padding(.vertical, 4)
    }

    private var icon: String {
        switch operation.kind {
        case .delete: return "trash"
        case .copy: return "doc.on.doc"
        case .move: return "arrow.turn.up.right"
        }
    }

    private var color: Color {
        switch operation.status {
        case .running: return .blue
        case .completed: return .green
        case .failed: return .red
        }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch operation.status {
        case .running: ProgressView().controlSize(.small)
        case .completed: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
        }
    }
}
