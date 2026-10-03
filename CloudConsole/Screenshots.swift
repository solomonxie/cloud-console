#if SCREENSHOTS
import SwiftUI

/// Store screenshots only (built with `SCREENSHOTS`): `-screen <name>` opens that screen in Demo mode, lock bypassed.
enum Screenshots {
    static let screen = UserDefaults.standard.string(forKey: "screen")

    static let endID = "screenshot-end"

    struct ScrollToEnd: ViewModifier {
        let active: Bool

        func body(content: Content) -> some View {
            ScrollViewReader { proxy in
                content.task {
                    guard active else { return }
                    try? await Task.sleep(for: .seconds(2))
                    proxy.scrollTo(Screenshots.endID, anchor: .bottom)
                }
            }
        }
    }

    static func `is`(_ name: String) -> Bool { screen == name }

    @MainActor static func prepare() {
        guard screen != nil else { return }
        UserDefaults.standard.set(true, forKey: AppData.demoKey)
        HomeStore.resetDemo()
        UserDefaults.standard.set(#"{"key": "img/hero-autumn.jpg", "width": 320}"#, forKey: "lambda.input.us-east-1/image-resize")
        let lock = AppLockManager.shared
        lock.isFaceIDEnabled = lock.faceIDAvailable
        lock.isLocked = false
    }

    @MainActor static func path(_ connections: [CloudConnection]) -> [HomeRoute] {
        guard let aws = connections.first(where: { $0.vendor == .aws }) else { return [] }
        let credential = HomeStore.signerCredential(forConnectionID: aws.id)
        func list<T: Decodable>(_ type: T.Type, _ kind: String) -> T? {
            try? DemoCloud.value(T.self, cacheKey: "\(kind):\(credential.accessKeyID)")
        }
        switch screen {
        case "billing":
            return [.service(connection: aws, kind: .billing)]
        case "s3":
            return [.service(connection: aws, kind: .s3),
                    .bucketObjects(connectionID: aws.id, service: .s3, bucketName: "northwind-web-assets", region: "us-east-1", prefix: "", credential: credential)]
        case "ec2":
            return [.service(connection: aws, kind: .ec2)]
        case "ec2-health":
            guard let instance = list([EC2Instance].self, "ec2-instances@us-east-1")?.first else { return [] }
            return [.service(connection: aws, kind: .ec2), .ec2Instance(instance: instance, region: "us-east-1", credential: credential)]
        case "lambda":
            return [.service(connection: aws, kind: .lambda)]
        case "lambda-run":
            guard let function = list([LambdaFunctionSummary].self, "lambda-functions@us-east-1")?.first else { return [] }
            return [.service(connection: aws, kind: .lambda), .lambdaFunction(function: function, region: "us-east-1", credential: credential)]
        case "iam":
            guard let user = list([IAMUser].self, "iam-users")?.first(where: { $0.userName == "ben.ortiz" }) else { return [] }
            return [.service(connection: aws, kind: .iamUsers), .iamUser(user: user, credential: credential)]
        default:
            return []
        }
    }
}
#endif
