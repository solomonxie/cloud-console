import SwiftUI

@MainActor
final class BucketsStore: ObservableObject {
    @Published var buckets: [S3Bucket] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let credential: AWSSigV4Signer.Credential

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        do {
            var list = try await S3Client.listBuckets(credential: credential)
            let credential = self.credential
            await withTaskGroup(of: (Int, String?).self) { group in
                for (index, bucket) in list.enumerated() {
                    group.addTask {
                        let region = try? await S3Client.bucketRegion(name: bucket.name, credential: credential)
                        return (index, region)
                    }
                }
                for await (index, region) in group {
                    list[index].region = region
                }
            }
            buckets = list.sorted { $0.name < $1.name }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct BucketsListView: View {
    let connection: CloudConnection
    let credential: AWSSigV4Signer.Credential
    @StateObject private var store: BucketsStore

    init(store: HomeStore, connection: CloudConnection) {
        self.connection = connection
        let credential = Self.signerCredential(store: store, connection: connection)
        self.credential = credential
        _store = StateObject(wrappedValue: BucketsStore(credential: credential))
    }

    var body: some View {
        Group {
            if store.isLoading && store.buckets.isEmpty {
                ProgressView("Loading buckets…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage = store.errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load buckets", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await store.load() } }
                }
            } else if store.buckets.isEmpty {
                ContentUnavailableView("No buckets", systemImage: "archivebox", description: Text("This account has no S3 buckets yet."))
            } else {
                List(store.buckets) { bucket in
                    NavigationLink {
                        BucketObjectsView(bucketName: bucket.name, region: bucket.region ?? "us-east-1", credential: credential)
                    } label: {
                        HStack(spacing: 12) {
                            VendorBadge(systemImage: "archivebox.fill", color: connection.vendor.accentColor)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(bucket.name)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                if let region = bucket.region {
                                    Text(region)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await store.load() }
                .safeAreaInset(edge: .bottom) {
                    Text("\(store.buckets.count) bucket\(store.buckets.count == 1 ? "" : "s")")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(.bar)
                }
            }
        }
        .task { await store.load() }
    }

    private static func signerCredential(store: HomeStore, connection: CloudConnection) -> AWSSigV4Signer.Credential {
        guard case .keyPair(let id, let secret) = store.credential(for: connection) else {
            return AWSSigV4Signer.Credential(accessKeyID: "", secretAccessKey: "")
        }
        return AWSSigV4Signer.Credential(accessKeyID: id, secretAccessKey: secret)
    }
}

struct BucketObjectsView: View {
    let bucketName: String
    let region: String
    let credential: AWSSigV4Signer.Credential
    var prefix: String = ""

    @State private var result: S3ListResult?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading && result == nil {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Couldn't load this folder", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") { Task { await load() } }
                }
            } else if let result, result.folders.isEmpty && result.objects.isEmpty {
                ContentUnavailableView("Empty", systemImage: "tray", description: Text("Nothing at this path."))
            } else if let result {
                List {
                    ForEach(result.folders, id: \.self) { folder in
                        NavigationLink {
                            BucketObjectsView(bucketName: bucketName, region: region, credential: credential, prefix: folder)
                        } label: {
                            Label(name(of: folder), systemImage: "folder.fill")
                                .foregroundStyle(.primary)
                                .symbolRenderingMode(.multicolor)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    ForEach(result.objects) { object in
                        HStack {
                            Label(name(of: object.key), systemImage: "doc")
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer()
                            Text(byteCount(object.size))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
                .safeAreaInset(edge: .bottom) {
                    Text(statsLine(result))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(.bar)
                }
            }
        }
        .navigationTitle(prefix.isEmpty ? bucketName : name(of: prefix))
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            result = try await S3Client.listObjects(bucket: bucketName, region: region, prefix: prefix, credential: credential)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func statsLine(_ result: S3ListResult) -> String {
        let folderCount = result.folders.count
        let objectCount = result.objects.count
        let totalBytes = result.objects.reduce(0) { $0 + $1.size }
        var parts: [String] = []
        if folderCount > 0 { parts.append("\(folderCount) folder\(folderCount == 1 ? "" : "s")") }
        parts.append("\(objectCount) item\(objectCount == 1 ? "" : "s")")
        if totalBytes > 0 { parts.append(byteCount(totalBytes)) }
        return parts.joined(separator: " · ")
    }

    private func name(of path: String) -> String {
        let trimmed = path.hasSuffix("/") ? String(path.dropLast()) : path
        return trimmed.split(separator: "/").last.map(String.init) ?? trimmed
    }

    private func byteCount(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
