import SwiftUI

/// Lists COS buckets. Unlike S3, COS's bucket-listing response already includes each
/// bucket's region (`Location`), so there's no separate per-bucket region lookup needed.
@MainActor
final class COSBucketsStore: ObservableObject, ExpandableResourceStore {
    @Published var items: [S3Bucket] = []
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var visibleCount = 20

    private let credential: AWSSigV4Signer.Credential
    private let cacheKey: String

    init(credential: AWSSigV4Signer.Credential) {
        self.credential = credential
        self.cacheKey = "cos-buckets:\(credential.accessKeyID)"
    }

    func load(forceRefresh: Bool = false) async {
        isLoading = true
        errorMessage = nil
        do {
            items = try await cached(key: cacheKey, ttl: defaultResourceTTL, forceRefresh: forceRefresh) {
                try await TencentCOSClient.listBuckets(credential: credential).sorted { $0.name < $1.name }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
