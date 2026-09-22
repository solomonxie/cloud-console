import SwiftUI

/// A folder browser for picking a copy/move destination within the same bucket.
struct S3DestinationPicker: View {
    let service: StorageService
    let bucket: String
    let region: String
    let credential: AWSSigV4Signer.Credential
    let startPrefix: String
    let onChoose: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            S3DestinationBrowser(service: service, bucket: bucket, region: region, credential: credential, prefix: startPrefix, choose: choose)
                .navigationDestination(for: String.self) { folderPrefix in
                    S3DestinationBrowser(service: service, bucket: bucket, region: region, credential: credential, prefix: folderPrefix, choose: choose)
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
        }
    }

    private func choose(_ prefix: String) {
        onChoose(prefix)
        dismiss()
    }
}

private struct S3DestinationBrowser: View {
    let service: StorageService
    let bucket: String
    let region: String
    let credential: AWSSigV4Signer.Credential
    let prefix: String
    let choose: (String) -> Void

    @State private var folders: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load folders", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await load() } }
                }
            } else {
                List {
                    Section {
                        Button {
                            choose(prefix)
                        } label: {
                            Label("Choose This Folder", systemImage: "checkmark.circle.fill")
                        }
                    }
                    if !folders.isEmpty {
                        Section("Folders") {
                            ForEach(folders, id: \.self) { folder in
                                NavigationLink(folderName(folder), value: folder)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(prefix.isEmpty ? bucket : folderName(prefix))
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            let result: S3ListResult
            switch service {
            case .s3: result = try await S3Client.listObjects(bucket: bucket, region: region, prefix: prefix, credential: credential)
            case .cos: result = try await TencentCOSClient.listObjects(bucket: bucket, region: region, prefix: prefix, credential: credential)
            }
            folders = result.folders
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func folderName(_ path: String) -> String {
        let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
        return trimmed.split(separator: "/").last.map(String.init) ?? trimmed
    }
}
