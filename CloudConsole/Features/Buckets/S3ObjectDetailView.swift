import SwiftUI

/// Sheet opened by tapping a file: QuickLook preview plus the common single-file actions.
/// `onRemoved` lets the presenting list optimistically drop the row for delete/move.
struct S3ObjectDetailView: View {
    let connectionID: UUID
    let service: StorageService
    let bucket: String
    let region: String
    let credential: AWSSigV4Signer.Credential
    let object: S3Object
    var onRemoved: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var queue = S3OperationQueue.shared

    @State private var localFileURL: URL?
    @State private var isDownloading = true
    @State private var downloadError: String?

    @State private var showingDeleteConfirm = false
    @State private var showingRename = false
    @State private var newName = ""
    @State private var destinationAction: DestinationAction?

    private enum DestinationAction: Identifiable { case copy, move; var id: Self { self } }

    var body: some View {
        NavigationStack {
            Group {
                if let localFileURL {
                    QuickLookPreview(url: localFileURL)
                        .ignoresSafeArea(edges: .bottom)
                } else if let downloadError {
                    ContentUnavailableView {
                        Label("Couldn't load preview", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(downloadError)
                    } actions: {
                        Button("Retry") { Task { await downloadPreview() } }
                    }
                } else {
                    ProgressView("Loading preview…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle(name(of: object.key))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        ShareLink(item: shareURL) {
                            Label("Share Link", systemImage: "square.and.arrow.up")
                        }
                        Button {
                            newName = name(of: object.key)
                            showingRename = true
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        Button {
                            queue.enqueueCopy(connectionID: connectionID, service: service, bucket: bucket, region: region, key: object.key, isFolder: false)
                        } label: {
                            Label("Duplicate", systemImage: "doc.on.doc")
                        }
                        Button { destinationAction = .copy } label: {
                            Label("Copy to…", systemImage: "folder")
                        }
                        Button { destinationAction = .move } label: {
                            Label("Move to…", systemImage: "folder.fill")
                        }
                        Button(role: .destructive) { showingDeleteConfirm = true } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .task { await downloadPreview() }
        .confirmationDialog("Delete \(name(of: object.key))?", isPresented: $showingDeleteConfirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                queue.enqueueDelete(connectionID: connectionID, service: service, bucket: bucket, region: region, key: object.key, isFolder: false)
                onRemoved()
                dismiss()
            }
        }
        .alert("Rename", isPresented: $showingRename) {
            TextField("New name", text: $newName)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            Button("Cancel", role: .cancel) {}
            Button("Rename") {
                queue.enqueueRename(connectionID: connectionID, service: service, bucket: bucket, region: region, key: object.key, isFolder: false, newName: newName)
                onRemoved()
                dismiss()
            }
        }
        .sheet(item: $destinationAction) { action in
            S3DestinationPicker(service: service, bucket: bucket, region: region, credential: credential, startPrefix: "") { destinationPrefix in
                switch action {
                case .copy:
                    queue.enqueueCopyTo(connectionID: connectionID, service: service, bucket: bucket, region: region, key: object.key, isFolder: false, destinationPrefix: destinationPrefix)
                case .move:
                    queue.enqueueMoveTo(connectionID: connectionID, service: service, bucket: bucket, region: region, key: object.key, isFolder: false, destinationPrefix: destinationPrefix)
                    onRemoved()
                    dismiss()
                }
            }
        }
    }

    private var shareURL: URL {
        switch service {
        case .s3: S3Client.presignedURL(bucket: bucket, region: region, key: object.key, credential: credential)
        case .cos: TencentCOSClient.presignedURL(bucket: bucket, region: region, key: object.key, credential: credential)
        }
    }

    private func downloadPreview() async {
        isDownloading = true
        downloadError = nil
        do {
            let data: Data
            switch service {
            case .s3: data = try await S3Client.downloadObject(bucket: bucket, region: region, key: object.key, credential: credential)
            case .cos: data = try await TencentCOSClient.downloadObject(bucket: bucket, region: region, key: object.key, credential: credential)
            }
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent(name(of: object.key))
            try FileManager.default.createDirectory(at: tempURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: tempURL, options: .atomic)
            localFileURL = tempURL
        } catch {
            downloadError = error.localizedDescription
        }
        isDownloading = false
    }

    private func name(of path: String) -> String {
        path.split(separator: "/").last.map(String.init) ?? path
    }
}
