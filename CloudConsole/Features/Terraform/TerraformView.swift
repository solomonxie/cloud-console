import SwiftUI

struct TerraformView: View {
    @State private var draftPrompt = ""

    var body: some View {
        NavigationStack {
            List {
                Section("AI-draft a change") {
                    TextField("Describe the change...", text: $draftPrompt, axis: .vertical)
                    Button("Draft") {}
                }
                Section {
                    NavigationLink("Review diff") {
                        Text("Diff preview coming soon")
                            .foregroundStyle(.secondary)
                            .navigationTitle("Review diff")
                    }
                    Button("Apply") {}
                        .disabled(true)
                }
            }
            .navigationTitle("Terraform")
        }
    }
}

#Preview {
    TerraformView()
}
