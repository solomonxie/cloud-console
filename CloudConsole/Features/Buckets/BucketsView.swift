import SwiftUI
import PhotosUI

@MainActor
final class BucketsStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [S3Bucket] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "s3-buckets:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                var list = try await S3Client.listBuckets(credential: credential)
                await withTaskGroup(of: (Int, String?).self) { group in
                    for (index, bucket) in list.enumerated() {
                        group.addTask {
                            let region = try? await S3Client.bucketRegion(name: bucket.name)
                            return (index, region)
                        }
                    }
                    for await (index, region) in group {
                        list[index].region = region
                    }
                }
                return list.sorted { $0.name < $1.name }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct BucketRow: View {
    let bucket: S3Bucket
    let connection: CloudConnection

    var body: some View {
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

struct BucketObjectsView: View {
    let connectionID: UUID
    let service: StorageService
    let bucketName: String
    let region: String
    let credential: AWSSigV4Signer.Credential
    var prefix: String = ""

    @State private var result: S3ListResult?
    @State private var isLoading = true
    @State private var errorMessage: String?

    @ObservedObject private var queue = S3OperationQueue.shared
    @State private var pendingDeleteKey: String?
    @State private var pendingDeleteIsFolder = false
    @State private var showingDeleteConfirm = false
    @State private var renamingKey: String?
    @State private var renamingIsFolder = false
    @State private var newName = ""
    @State private var showingRename = false

    @State private var isSelecting = false
    @State private var selectedKeys: Set<String> = []
    @State private var showingBatchDeleteConfirm = false
    @State private var shareAlertMessage: String?

    @State private var showingObjectDetail: S3Object?
    @State private var destinationAction: DestinationAction?
    @State private var visibleObjectCount = BucketObjectsView.objectPageSize
    private static let objectPageSize = 100

    @State private var showingPhotoPicker = false
    @State private var photoPickerItems: [PhotosPickerItem] = []
    @State private var showingFileImporter = false
    @State private var uploadErrorMessage: String?

    private struct DestinationAction: Identifiable {
        let key: String
        let isFolder: Bool
        let isMove: Bool
        var id: String { "\(isMove)|\(key)" }
    }

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
                        row(key: folder, isFolder: true) {
                            Label(name(of: folder), systemImage: "folder.fill")
                                .foregroundStyle(.primary)
                                .symbolRenderingMode(.multicolor)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    ForEach(result.objects.prefix(visibleObjectCount)) { object in
                        row(key: object.key, isFolder: false, onTap: { showingObjectDetail = object }) {
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
                    if result.objects.count > visibleObjectCount {
                        Button("Load more (\(result.objects.count - visibleObjectCount))") {
                            visibleObjectCount += Self.objectPageSize
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
                .safeAreaInset(edge: .bottom) {
                    if isSelecting {
                        selectionBar
                    } else {
                        Text(statsLine(result))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 6)
                            .frame(maxWidth: .infinity)
                            .background(.bar)
                    }
                }
            }
        }
        .navigationTitle(prefix.isEmpty ? bucketName : name(of: prefix))
        .task { await load() }
        .toolbar {
            if !isSelecting {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            showingPhotoPicker = true
                        } label: {
                            Label("Photos", systemImage: "photo.on.rectangle")
                        }
                        Button {
                            showingFileImporter = true
                        } label: {
                            Label("Files", systemImage: "doc")
                        }
                    } label: {
                        Label("Upload", systemImage: "square.and.arrow.up.on.square")
                    }
                }
            }
            if result != nil, !(result?.folders.isEmpty ?? true) || !(result?.objects.isEmpty ?? true) {
                ToolbarItem(placement: .primaryAction) {
                    Button(isSelecting ? "Cancel" : "Select") {
                        isSelecting.toggle()
                        selectedKeys.removeAll()
                    }
                }
            }
        }
        .photosPicker(isPresented: $showingPhotoPicker, selection: $photoPickerItems, matching: .any(of: [.images, .videos]))
        .onChange(of: photoPickerItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await handlePhotoSelection(items) }
        }
        .fileImporter(isPresented: $showingFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result {
            case .success(let urls):
                Task { await handleFileSelection(urls) }
            case .failure(let error):
                uploadErrorMessage = error.localizedDescription
            }
        }
        .alert("Upload Failed", isPresented: .constant(uploadErrorMessage != nil), presenting: uploadErrorMessage) { _ in
            Button("OK") { uploadErrorMessage = nil }
        } message: { message in
            Text(message)
        }
        .confirmationDialog(
            "Delete \(pendingDeleteKey.map { name(of: $0) } ?? "")?",
            isPresented: $showingDeleteConfirm, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { performDelete() }
        } message: {
            Text(pendingDeleteIsFolder ? "Deletes everything inside this folder. This runs in the background and can't be undone." : "This can't be undone.")
        }
        .confirmationDialog(
            "Delete \(selectedKeys.count) item\(selectedKeys.count == 1 ? "" : "s")?",
            isPresented: $showingBatchDeleteConfirm, titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { performBatchDelete() }
        } message: {
            Text("Folders are deleted with everything inside them. This runs in the background and can't be undone.")
        }
        .alert("Rename", isPresented: $showingRename) {
            TextField("New name", text: $newName)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { performRename() }
        }
        .alert("Links Copied", isPresented: .constant(shareAlertMessage != nil), presenting: shareAlertMessage) { _ in
            Button("OK") { shareAlertMessage = nil }
        } message: { message in
            Text(message)
        }
        .sheet(item: $showingObjectDetail) { object in
            S3ObjectDetailView(connectionID: connectionID, service: service, bucket: bucketName, region: region, credential: credential, object: object) {
                result?.objects.removeAll { $0.key == object.key }
            }
        }
        .sheet(item: $destinationAction) { action in
            S3DestinationPicker(service: service, sourceBucket: bucketName, sourceRegion: region, credential: credential, startPrefix: "") { destBucket, destRegion, destinationPrefix in
                if action.isMove {
                    queue.enqueueMoveTo(connectionID: connectionID, service: service, bucket: bucketName, region: region, key: action.key, isFolder: action.isFolder, destinationBucket: destBucket, destinationRegion: destRegion, destinationPrefix: destinationPrefix)
                    result?.folders.removeAll { $0 == action.key }
                    result?.objects.removeAll { $0.key == action.key }
                } else {
                    queue.enqueueCopyTo(connectionID: connectionID, service: service, bucket: bucketName, region: region, key: action.key, isFolder: action.isFolder, destinationBucket: destBucket, destinationRegion: destRegion, destinationPrefix: destinationPrefix)
                }
            }
        }
    }

    @ViewBuilder
    private func row<Content: View>(key: String, isFolder: Bool, onTap: (() -> Void)? = nil, @ViewBuilder label: () -> Content) -> some View {
        if isSelecting {
            Button {
                if selectedKeys.contains(key) { selectedKeys.remove(key) } else { selectedKeys.insert(key) }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: selectedKeys.contains(key) ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selectedKeys.contains(key) ? Color.accentColor : Color.secondary)
                    label()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else if isFolder {
            NavigationLink(value: HomeRoute.bucketObjects(connectionID: connectionID, service: service, bucketName: bucketName, region: region, prefix: key, credential: credential)) {
                label()
            }
            .rowActions(
                key: key, isFolder: true,
                onDelete: { confirmDelete(key: key, isFolder: true) },
                onRename: { startRename(key: key, isFolder: true) },
                onDuplicate: { queue.enqueueCopy(connectionID: connectionID, service: service, bucket: bucketName, region: region, key: key, isFolder: true) },
                onCopyTo: { destinationAction = DestinationAction(key: key, isFolder: true, isMove: false) },
                onMoveTo: { destinationAction = DestinationAction(key: key, isFolder: true, isMove: true) }
            )
        } else {
            Button(action: { onTap?() }) {
                label().foregroundStyle(.primary)
            }
            .buttonStyle(.plain)
            .rowActions(
                key: key, isFolder: false,
                onDelete: { confirmDelete(key: key, isFolder: false) },
                onRename: { startRename(key: key, isFolder: false) },
                onDuplicate: { queue.enqueueCopy(connectionID: connectionID, service: service, bucket: bucketName, region: region, key: key, isFolder: false) },
                onCopyTo: { destinationAction = DestinationAction(key: key, isFolder: false, isMove: false) },
                onMoveTo: { destinationAction = DestinationAction(key: key, isFolder: false, isMove: true) }
            )
        }
    }

    private var selectionBar: some View {
        HStack {
            Text("\(selectedKeys.count) selected")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Spacer()
            Button {
                performBatchShare()
            } label: {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            .disabled(!selectedKeys.contains { key in result?.objects.contains { $0.key == key } ?? false })
            Button(role: .destructive) {
                showingBatchDeleteConfirm = true
            } label: {
                Label("Delete", systemImage: "trash")
            }
            .disabled(selectedKeys.isEmpty)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func confirmDelete(key: String, isFolder: Bool) {
        pendingDeleteKey = key
        pendingDeleteIsFolder = isFolder
        showingDeleteConfirm = true
    }

    private func performDelete() {
        guard let key = pendingDeleteKey else { return }
        queue.enqueueDelete(connectionID: connectionID, service: service, bucket: bucketName, region: region, key: key, isFolder: pendingDeleteIsFolder)
        result?.folders.removeAll { $0 == key }
        result?.objects.removeAll { $0.key == key }
        pendingDeleteKey = nil
    }

    private func performBatchDelete() {
        for key in selectedKeys {
            let isFolder = result?.folders.contains(key) ?? false
            queue.enqueueDelete(connectionID: connectionID, service: service, bucket: bucketName, region: region, key: key, isFolder: isFolder)
        }
        result?.folders.removeAll { selectedKeys.contains($0) }
        result?.objects.removeAll { selectedKeys.contains($0.key) }
        selectedKeys.removeAll()
        isSelecting = false
    }

    /// Presigned links, not a write — this is local HMAC signing, so it's instant and
    /// doesn't touch the network or the operation queue.
    private func performBatchShare() {
        let keys = selectedKeys.filter { key in result?.objects.contains { $0.key == key } ?? false }
        guard !keys.isEmpty else { return }
        let links = keys.sorted().map { presignedURL(for: $0).absoluteString }
        UIPasteboard.general.string = links.joined(separator: "\n")
        shareAlertMessage = "\(links.count) link\(links.count == 1 ? "" : "s") copied to the clipboard. Each is valid for 1 hour."
        selectedKeys.removeAll()
        isSelecting = false
    }

    private func presignedURL(for key: String) -> URL {
        switch service {
        case .s3: S3Client.presignedURL(bucket: bucketName, region: region, key: key, credential: credential)
        case .cos: TencentCOSClient.presignedURL(bucket: bucketName, region: region, key: key, credential: credential)
        }
    }

    private func handlePhotoSelection(_ items: [PhotosPickerItem]) async {
        var files: [(fileName: String, data: Data)] = []
        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            files.append((fileName: "Photo-\(Int(Date().timeIntervalSince1970))-\(index).\(ext)", data: data))
        }
        photoPickerItems = []
        guard !files.isEmpty else {
            uploadErrorMessage = "Couldn't read the selected photos."
            return
        }
        queue.enqueueUpload(connectionID: connectionID, service: service, bucket: bucketName, region: region, destinationPrefix: prefix, files: files)
    }

    private func handleFileSelection(_ urls: [URL]) async {
        var files: [(fileName: String, data: Data)] = []
        for url in urls {
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            files.append((fileName: url.lastPathComponent, data: data))
        }
        guard !files.isEmpty else {
            uploadErrorMessage = "Couldn't read the selected files."
            return
        }
        queue.enqueueUpload(connectionID: connectionID, service: service, bucket: bucketName, region: region, destinationPrefix: prefix, files: files)
    }

    private func startRename(key: String, isFolder: Bool) {
        renamingKey = key
        renamingIsFolder = isFolder
        newName = name(of: key)
        showingRename = true
    }

    private func performRename() {
        guard let key = renamingKey, !newName.isEmpty else { return }
        queue.enqueueRename(connectionID: connectionID, service: service, bucket: bucketName, region: region, key: key, isFolder: renamingIsFolder, newName: newName)
        renamingKey = nil
    }

    /// Always live — folder contents change too often (and matter too much to get right)
    /// to risk showing a stale cached listing.
    private func load() async {
        isLoading = true
        errorMessage = nil
        visibleObjectCount = Self.objectPageSize
        do {
            switch service {
            case .s3:
                result = try await S3Client.listObjects(bucket: bucketName, region: region, prefix: prefix, credential: credential)
            case .cos:
                result = try await TencentCOSClient.listObjects(bucket: bucketName, region: region, prefix: prefix, credential: credential)
            }
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

private extension View {
    /// Swipe + long-press actions shared by folder and object rows: delete (with
    /// confirmation upstream), rename, copy/move to another folder, and duplicate-in-place —
    /// all queued, not synchronous.
    func rowActions(
        key: String, isFolder: Bool,
        onDelete: @escaping () -> Void, onRename: @escaping () -> Void, onDuplicate: @escaping () -> Void,
        onCopyTo: @escaping () -> Void, onMoveTo: @escaping () -> Void
    ) -> some View {
        self
            .swipeActions(edge: .trailing) {
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
                Button(action: onRename) {
                    Label("Rename", systemImage: "pencil")
                }
                .tint(.orange)
            }
            .contextMenu {
                Button(action: onRename) {
                    Label("Rename", systemImage: "pencil")
                }
                Button(action: onDuplicate) {
                    Label("Duplicate", systemImage: "doc.on.doc")
                }
                Button(action: onCopyTo) {
                    Label("Copy to…", systemImage: "folder")
                }
                Button(action: onMoveTo) {
                    Label("Move to…", systemImage: "folder.fill")
                }
                Button(role: .destructive, action: onDelete) {
                    Label("Delete", systemImage: "trash")
                }
            }
    }
}
