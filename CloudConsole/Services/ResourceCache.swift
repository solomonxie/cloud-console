import Foundation

/// Default freshness window for cached resource listings — long enough that reopening a
/// screen a few minutes later still feels instant, short enough that stale data doesn't
/// linger for a whole session.
let defaultResourceTTL: TimeInterval = 300

/// A small disk-backed, TTL-checked cache for read-only resource listings (buckets, IAM
/// users/roles, billing, …) so reopening a screen shows data instantly instead of a spinner.
/// Not for anything write-related — the operation queue has its own, separate persistence.
actor ResourceCache {
    static let shared = ResourceCache()

    private struct Entry: Codable {
        let data: Data
        let savedAt: Date
    }

    private var memory: [String: Entry] = [:]

    /// Returns the cached value if present and younger than `ttl`; otherwise nil (a miss,
    /// not an error — callers just fetch fresh and `set` the result).
    func get<T: Decodable>(_ type: T.Type, key: String, ttl: TimeInterval) -> T? {
        guard let entry = memory[key] ?? loadFromDisk(key: key) else { return nil }
        memory[key] = entry
        guard Date().timeIntervalSince(entry.savedAt) < ttl else { return nil }
        return try? JSONDecoder().decode(T.self, from: entry.data)
    }

    func set<T: Encodable>(_ value: T, key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        let entry = Entry(data: data, savedAt: Date())
        memory[key] = entry
        try? data.write(to: fileURL(key: key), options: .atomic)
    }

    /// Drops a cached entry outright — used after a write (delete/rename/move) so the next
    /// load doesn't serve a listing that's gone stale before its TTL was up.
    func invalidate(key: String) {
        memory[key] = nil
        try? FileManager.default.removeItem(at: fileURL(key: key))
    }

    private func loadFromDisk(key: String) -> Entry? {
        guard let data = try? Data(contentsOf: fileURL(key: key)) else { return nil }
        // The file holds the raw encoded value, not the Entry wrapper — its mtime is the
        // save time, avoiding a second encode/decode layer just to track that.
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL(key: key).path),
              let savedAt = attributes[.modificationDate] as? Date else { return nil }
        return Entry(data: data, savedAt: savedAt)
    }

    private func fileURL(key: String) -> URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("ResourceCache")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safeName = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? UUID().uuidString
        return dir.appendingPathComponent(safeName)
    }
}

/// Fetches through the shared cache: returns a cached hit under `ttl` unless `forceRefresh`,
/// otherwise calls `fetch` and caches the result.
func cached<T: Codable>(key: String, ttl: TimeInterval, forceRefresh: Bool = false, fetch: () async throws -> T) async throws -> T {
    if !forceRefresh, let hit = await ResourceCache.shared.get(T.self, key: key, ttl: ttl) {
        return hit
    }
    let value = try await fetch()
    await ResourceCache.shared.set(value, key: key)
    return value
}
