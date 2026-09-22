import Foundation

/// Which object-storage API an operation's requests should be built for — the queue's
/// engine (persistence, background session, retry) is identical either way.
enum StorageService: String, Codable, Hashable {
    case s3, cos
}

struct S3OperationItem: Codable, Hashable {
    let source: String
    let destination: String?
    var state: State = .pending

    enum State: String, Codable {
        case pending, copied, done, failed
    }
}

struct S3Operation: Codable, Identifiable, Hashable {
    enum Kind: String, Codable {
        case delete, copy, move
    }
    enum Status: String, Codable {
        case running, completed, failed
    }

    let id: UUID
    let connectionID: UUID
    let service: StorageService
    let bucket: String
    let region: String
    let kind: Kind
    let label: String
    var items: [S3OperationItem]
    var status: Status
    var errorMessage: String?
    let createdAt: Date

    var completedCount: Int { items.filter { $0.state == .done }.count }
    var isFinished: Bool { status == .completed || status == .failed }
}

/// One-at-a-time queue of S3 write operations (delete/copy/move), persisted to disk and
/// executed over a background `URLSession` so a folder delete or rename keeps going after
/// you switch apps or lock the phone. Force-quitting the app does cancel in-flight requests —
/// that's an iOS platform limit, not a bug — but any unfinished items just stay `.pending` and
/// pick back up automatically next time the app opens.
@MainActor
final class S3OperationQueue: NSObject, ObservableObject {
    static let shared = S3OperationQueue()

    @Published private(set) var operations: [S3Operation] = []

    private var isBusy = false
    private let batchDeleteChunkSize = 1000
    private var tempFileByTaskID: [Int: URL] = [:]
    private var responseDataByTaskID: [Int: Data] = [:]

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "com.solomonxie.cloudconsole.s3ops")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    /// Stashed by the app delegate on a background-session wake; call after all events drain.
    var backgroundCompletionHandler: (() -> Void)?

    private override init() {
        super.init()
        operations = Self.load()
        isBusy = true
        session.getAllTasks { [weak self] tasks in
            Task { @MainActor in
                self?.isBusy = !tasks.isEmpty
                self?.processNext()
            }
        }
    }

    // MARK: Enqueueing

    func enqueueDelete(connectionID: UUID, service: StorageService, bucket: String, region: String, key: String, isFolder: Bool) {
        enqueue(kind: .delete, connectionID: connectionID, service: service, bucket: bucket, region: region, key: key, isFolder: isFolder,
                label: "Delete \(isFolder ? "folder " : "")\(displayName(key))", newKey: nil)
    }

    /// Duplicates in place, next to the original, with a "-copy" suffix.
    func enqueueCopy(connectionID: UUID, service: StorageService, bucket: String, region: String, key: String, isFolder: Bool) {
        enqueue(kind: .copy, connectionID: connectionID, service: service, bucket: bucket, region: region, key: key, isFolder: isFolder,
                label: "Copy \(displayName(key))", newKey: duplicateKey(key, isFolder: isFolder))
    }

    func enqueueRename(connectionID: UUID, service: StorageService, bucket: String, region: String, key: String, isFolder: Bool, newName: String) {
        enqueue(kind: .move, connectionID: connectionID, service: service, bucket: bucket, region: region, key: key, isFolder: isFolder,
                label: "Rename \(displayName(key)) → \(newName)", newKey: renamedKey(key, isFolder: isFolder, newName: newName))
    }

    /// `destinationPrefix` is a folder path ("" for bucket root, otherwise ending in "/").
    func enqueueCopyTo(connectionID: UUID, service: StorageService, bucket: String, region: String, key: String, isFolder: Bool, destinationPrefix: String) {
        let newKey = destinationPrefix + displayName(key) + (isFolder ? "/" : "")
        enqueue(kind: .copy, connectionID: connectionID, service: service, bucket: bucket, region: region, key: key, isFolder: isFolder,
                label: "Copy \(displayName(key)) to \(destinationPrefix.isEmpty ? "/" : destinationPrefix)", newKey: newKey)
    }

    func enqueueMoveTo(connectionID: UUID, service: StorageService, bucket: String, region: String, key: String, isFolder: Bool, destinationPrefix: String) {
        let newKey = destinationPrefix + displayName(key) + (isFolder ? "/" : "")
        enqueue(kind: .move, connectionID: connectionID, service: service, bucket: bucket, region: region, key: key, isFolder: isFolder,
                label: "Move \(displayName(key)) to \(destinationPrefix.isEmpty ? "/" : destinationPrefix)", newKey: newKey)
    }

    private func enqueue(kind: S3Operation.Kind, connectionID: UUID, service: StorageService, bucket: String, region: String, key: String, isFolder: Bool, label: String, newKey: String?) {
        let operation = S3Operation(id: UUID(), connectionID: connectionID, service: service, bucket: bucket, region: region, kind: kind, label: label, items: [], status: .running, errorMessage: nil, createdAt: Date())
        operations.insert(operation, at: 0)
        save()
        Task {
            await expandAndStart(operationID: operation.id, keys: isFolder ? nil : [key], prefix: isFolder ? key : nil) { sourceKey in
                guard let newKey else { return nil }
                return isFolder ? newKey + String(sourceKey.dropFirst(key.count)) : newKey
            }
        }
    }

    func retry(_ operationID: UUID) {
        guard let index = operations.firstIndex(where: { $0.id == operationID }) else { return }
        for itemIndex in operations[index].items.indices where operations[index].items[itemIndex].state == .failed {
            operations[index].items[itemIndex].state = .pending
        }
        operations[index].status = .running
        operations[index].errorMessage = nil
        save()
        processNext()
    }

    func clearFinished() {
        operations.removeAll { $0.isFinished }
        save()
    }

    // MARK: Expansion — listing a folder's keys happens in the foreground (it's just GETs),
    // the resulting delete/copy/move requests are what actually go through the background session.

    private func expandAndStart(operationID: UUID, keys: [String]?, prefix: String?, destinationTransform: @escaping (String) -> String?) async {
        guard let index = operations.firstIndex(where: { $0.id == operationID }) else { return }
        let op = operations[index]
        let credential = HomeStore.signerCredential(forConnectionID: op.connectionID)
        do {
            let sourceKeys: [String]
            if let keys {
                sourceKeys = keys
            } else if let prefix {
                switch op.service {
                case .s3:
                    sourceKeys = try await S3Client.listAllKeys(bucket: op.bucket, region: op.region, prefix: prefix, credential: credential)
                case .cos:
                    sourceKeys = try await TencentCOSClient.listAllKeys(bucket: op.bucket, region: op.region, prefix: prefix, credential: credential)
                }
            } else {
                sourceKeys = []
            }
            guard let refreshedIndex = operations.firstIndex(where: { $0.id == operationID }) else { return }
            operations[refreshedIndex].items = sourceKeys.map {
                S3OperationItem(source: $0, destination: destinationTransform($0))
            }
            save()
            processNext()
        } catch {
            guard let refreshedIndex = operations.firstIndex(where: { $0.id == operationID }) else { return }
            operations[refreshedIndex].status = .failed
            operations[refreshedIndex].errorMessage = error.localizedDescription
            save()
        }
    }

    // MARK: Processing — exactly one task in flight at a time, so resuming after a relaunch
    // is just "look at what's still .pending" with no separate in-flight bookkeeping to reconcile.

    private func processNext() {
        guard !isBusy else { return }
        guard let opIndex = operations.firstIndex(where: { $0.status == .running && !$0.items.isEmpty }) else { return }
        let credential = HomeStore.signerCredential(forConnectionID: operations[opIndex].connectionID)
        let op = operations[opIndex]

        switch op.kind {
        case .delete:
            let pendingIndices = op.items.indices.filter { op.items[$0].state == .pending }
            guard !pendingIndices.isEmpty else { finish(opIndex); return }
            let chunk = Array(pendingIndices.prefix(batchDeleteChunkSize))
            let keys = chunk.map { op.items[$0].source }
            let (request, body) = batchDeleteRequest(op.service, bucket: op.bucket, region: op.region, keys: keys, credential: credential)
            submit(request, body: body, token: TaskToken(operationID: op.id, indices: chunk, phase: .delete))
        case .copy:
            guard let idx = op.items.firstIndex(where: { $0.state == .pending }) else { finish(opIndex); return }
            let item = op.items[idx]
            let request = copyObjectRequest(op.service, bucket: op.bucket, region: op.region, sourceKey: item.source, destKey: item.destination ?? item.source, credential: credential)
            submit(request, body: Data(), token: TaskToken(operationID: op.id, indices: [idx], phase: .copy))
        case .move:
            guard let idx = op.items.firstIndex(where: { $0.state == .pending || $0.state == .copied }) else { finish(opIndex); return }
            let item = op.items[idx]
            if item.state == .pending {
                let request = copyObjectRequest(op.service, bucket: op.bucket, region: op.region, sourceKey: item.source, destKey: item.destination ?? item.source, credential: credential)
                submit(request, body: Data(), token: TaskToken(operationID: op.id, indices: [idx], phase: .copy))
            } else {
                let request = deleteObjectRequest(op.service, bucket: op.bucket, region: op.region, key: item.source, credential: credential)
                submit(request, body: Data(), token: TaskToken(operationID: op.id, indices: [idx], phase: .delete))
            }
        }
    }

    private func deleteObjectRequest(_ service: StorageService, bucket: String, region: String, key: String, credential: AWSSigV4Signer.Credential) -> URLRequest {
        switch service {
        case .s3: S3Client.deleteObjectRequest(bucket: bucket, region: region, key: key, credential: credential)
        case .cos: TencentCOSClient.deleteObjectRequest(bucket: bucket, region: region, key: key, credential: credential)
        }
    }

    private func copyObjectRequest(_ service: StorageService, bucket: String, region: String, sourceKey: String, destKey: String, credential: AWSSigV4Signer.Credential) -> URLRequest {
        switch service {
        case .s3: S3Client.copyObjectRequest(bucket: bucket, region: region, sourceKey: sourceKey, destKey: destKey, credential: credential)
        case .cos: TencentCOSClient.copyObjectRequest(bucket: bucket, region: region, sourceKey: sourceKey, destKey: destKey, credential: credential)
        }
    }

    private func batchDeleteRequest(_ service: StorageService, bucket: String, region: String, keys: [String], credential: AWSSigV4Signer.Credential) -> (request: URLRequest, body: Data) {
        switch service {
        case .s3: S3Client.batchDeleteRequest(bucket: bucket, region: region, keys: keys, credential: credential)
        case .cos: TencentCOSClient.batchDeleteRequest(bucket: bucket, region: region, keys: keys, credential: credential)
        }
    }

    /// Background sessions can't upload from in-memory `Data` — only from a file on disk —
    /// so every request body, even an empty DELETE, goes through a scratch file.
    private func submit(_ request: URLRequest, body: Data, token: TaskToken) {
        isBusy = true
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        do {
            try body.write(to: fileURL)
        } catch {
            fail(token: token, message: "Couldn't prepare request: \(error.localizedDescription)")
            isBusy = false
            processNext()
            return
        }
        let task = session.uploadTask(with: request, fromFile: fileURL)
        task.taskDescription = token.encoded
        tempFileByTaskID[task.taskIdentifier] = fileURL
        task.resume()
    }

    private func fail(token: TaskToken, message: String) {
        guard let opIndex = operations.firstIndex(where: { $0.id == token.operationID }) else { return }
        for i in token.indices where operations[opIndex].items.indices.contains(i) {
            operations[opIndex].items[i].state = .failed
        }
        operations[opIndex].status = .failed
        operations[opIndex].errorMessage = message
        save()
    }

    private func finish(_ opIndex: Int) {
        operations[opIndex].status = operations[opIndex].items.contains { $0.state == .failed } ? .failed : .completed
        save()
        processNext()
    }

    // MARK: Naming helpers

    private func displayName(_ key: String) -> String {
        let trimmed = key.hasSuffix("/") ? String(key.dropLast()) : key
        return trimmed.split(separator: "/").last.map(String.init) ?? trimmed
    }

    private func duplicateKey(_ key: String, isFolder: Bool) -> String {
        if isFolder {
            let trimmed = String(key.dropLast())
            return trimmed + "-copy/"
        }
        let ext = (key as NSString).pathExtension
        let base = ext.isEmpty ? key : String(key.dropLast(ext.count + 1))
        return ext.isEmpty ? "\(base)-copy" : "\(base)-copy.\(ext)"
    }

    private func renamedKey(_ key: String, isFolder: Bool, newName: String) -> String {
        let trimmed = key.hasSuffix("/") ? String(key.dropLast()) : key
        let parent = trimmed.contains("/") ? String(trimmed[..<trimmed.lastIndex(of: "/")!]) + "/" : ""
        return isFolder ? parent + newName + "/" : parent + newName
    }

    // MARK: Persistence — operation metadata only, never credentials (those stay in Keychain).

    private static var storeURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("s3-operations.json")
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(operations) else { return }
        try? data.write(to: Self.storeURL, options: .atomic)
    }

    private static func load() -> [S3Operation] {
        guard let data = try? Data(contentsOf: storeURL) else { return [] }
        return (try? JSONDecoder().decode([S3Operation].self, from: data)) ?? []
    }
}

extension S3OperationQueue: URLSessionDataDelegate {
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        Task { @MainActor in
            self.responseDataByTaskID[dataTask.taskIdentifier, default: Data()].append(data)
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let token = TaskToken(encoded: task.taskDescription ?? "") else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode
        let statusOK = status.map { (200...299).contains($0) } ?? false
        let succeeded = error == nil && statusOK
        let transportMessage = error?.localizedDescription

        Task { @MainActor in
            self.isBusy = false
            if let fileURL = self.tempFileByTaskID.removeValue(forKey: task.taskIdentifier) {
                try? FileManager.default.removeItem(at: fileURL)
            }
            let responseBody = self.responseDataByTaskID.removeValue(forKey: task.taskIdentifier)
            guard let opIndex = self.operations.firstIndex(where: { $0.id == token.operationID }) else {
                self.processNext()
                return
            }
            for i in token.indices where self.operations[opIndex].items.indices.contains(i) {
                if !succeeded {
                    self.operations[opIndex].items[i].state = .failed
                } else if token.phase == .copy, self.operations[opIndex].kind == .move {
                    self.operations[opIndex].items[i].state = .copied
                } else {
                    self.operations[opIndex].items[i].state = .done
                }
            }
            if !succeeded {
                self.operations[opIndex].status = .failed
                self.operations[opIndex].errorMessage = Self.failureMessage(transportMessage: transportMessage, status: status, body: responseBody)
            }
            self.save()
            self.processNext()
        }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }

    private static func failureMessage(transportMessage: String?, status: Int?, body: Data?) -> String {
        if let transportMessage { return transportMessage }
        if let status, let body, !body.isEmpty {
            return AWSQueryError.parse(status: status, data: body).localizedDescription
        }
        if let status { return "Server returned HTTP \(status)" }
        return "Request failed"
    }
}

/// Encodes which operation/items/phase a background task belongs to, in the task's own
/// `taskDescription` — the only state that reliably survives a process relaunch.
private struct TaskToken {
    enum Phase: String { case copy, delete }
    let operationID: UUID
    let indices: [Int]
    let phase: Phase

    var encoded: String {
        "\(operationID.uuidString)|\(indices.map(String.init).joined(separator: ","))|\(phase.rawValue)"
    }

    init(operationID: UUID, indices: [Int], phase: Phase) {
        self.operationID = operationID
        self.indices = indices
        self.phase = phase
    }

    init?(encoded: String) {
        let parts = encoded.split(separator: "|", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let id = UUID(uuidString: String(parts[0])),
              let phase = Phase(rawValue: String(parts[2])) else { return nil }
        operationID = id
        indices = parts[1].split(separator: ",").compactMap { Int($0) }
        self.phase = phase
    }
}
