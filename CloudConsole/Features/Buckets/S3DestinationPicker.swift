import SwiftUI

/// A folder browser for picking a copy/move destination — within the source bucket by
/// default, or in any other bucket reachable with the same credential via "Switch Bucket".
struct S3DestinationPicker: View {
    let service: StorageService
    let sourceBucket: String
    let sourceRegion: String
    let credential: AWSSigV4Signer.Credential
    let startPrefix: String
    let onChoose: (_ bucket: String, _ region: String, _ prefix: String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            S3DestinationBrowser(service: service, bucket: sourceBucket, region: sourceRegion, credential: credential, prefix: startPrefix, choose: choose)
                .navigationDestination(for: DestinationRoute.self) { route in
                    switch route {
                    case .folder(let bucket, let region, let prefix):
                        S3DestinationBrowser(service: service, bucket: bucket, region: region, credential: credential, prefix: prefix, choose: choose)
                    case .bucketList:
                        DestinationBucketList(service: service, credential: credential)
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
        }
    }

    private func choose(_ bucket: String, _ region: String, _ prefix: String) {
        onChoose(bucket, region, prefix)
        dismiss()
    }
}

private enum DestinationRoute: Hashable {
    case folder(bucket: String, region: String, prefix: String)
    case bucketList
}

private struct S3DestinationBrowser: View {
    let service: StorageService
    let bucket: String
    let region: String
    let credential: AWSSigV4Signer.Credential
    let prefix: String
    let choose: (String, String, String) -> Void

    @State private var resolvedRegion: String
    @State private var folders: [String] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    init(service: StorageService, bucket: String, region: String, credential: AWSSigV4Signer.Credential, prefix: String, choose: @escaping (String, String, String) -> Void) {
        self.service = service
        self.bucket = bucket
        self.region = region
        self.credential = credential
        self.prefix = prefix
        self.choose = choose
        _resolvedRegion = State(initialValue: region)
    }

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
                            choose(bucket, resolvedRegion, prefix)
                        } label: {
                            Label("Choose This Folder", systemImage: "checkmark.circle.fill")
                        }
                    }
                    if !folders.isEmpty {
                        Section("Folders") {
                            ForEach(folders, id: \.self) { folder in
                                NavigationLink(folderName(folder), value: DestinationRoute.folder(bucket: bucket, region: resolvedRegion, prefix: folder))
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(prefix.isEmpty ? bucket : folderName(prefix))
        .toolbar {
            if prefix.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    NavigationLink("Switch Bucket", value: DestinationRoute.bucketList)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            // A bucket picked via "Switch Bucket" arrives with no known region yet (S3 doesn't
            // return one from ListBuckets); resolve it once before listing.
            if resolvedRegion.isEmpty, service == .s3 {
                resolvedRegion = try await S3Client.bucketRegion(name: bucket)
            }
            let result: S3ListResult
            switch service {
            case .s3: result = try await S3Client.listObjects(bucket: bucket, region: resolvedRegion, prefix: prefix, credential: credential)
            case .cos: result = try await TencentCOSClient.listObjects(bucket: bucket, region: resolvedRegion, prefix: prefix, credential: credential)
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

private struct DestinationBucketList: View {
    let service: StorageService
    let credential: AWSSigV4Signer.Credential

    @State private var buckets: [S3Bucket] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load buckets", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await load() } }
                }
            } else {
                List(buckets) { bucket in
                    NavigationLink(bucket.name, value: DestinationRoute.folder(bucket: bucket.name, region: bucket.region ?? "", prefix: ""))
                }
            }
        }
        .navigationTitle("Choose Bucket")
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            switch service {
            case .s3: buckets = try await S3Client.listBuckets(credential: credential).sorted { $0.name < $1.name }
            case .cos: buckets = try await TencentCOSClient.listBuckets(credential: credential).sorted { $0.name < $1.name }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
