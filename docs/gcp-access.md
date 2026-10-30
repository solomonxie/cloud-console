# Google Cloud access

The Google Cloud section talks straight to Google's APIs with one credential
you supply. It can only do what that credential's own IAM roles allow — there
is no backend and no way for the app to grant itself more. This page lists
which roles each view needs and how to get a credential.

## Credential types

Two kinds of JSON file are accepted, pasted or loaded with "Load from file…":

| Type | What it is | Notes |
| --- | --- | --- |
| `service_account` | A service account JSON key (IAM & Admin → Service Accounts → Keys → Add key → JSON). | The app signs a JWT with the key and exchanges it for a token (scope `https://www.googleapis.com/auth/cloud-platform`). |
| `authorized_user` | gcloud's application default credentials (ADC) for your own Google account. | Uses the refresh token gcloud stored. Acts as you, with your IAM roles. |

The credentials are stored only in `chrome.storage.local` on this device and
are sent only to `oauth2.googleapis.com` to get access tokens.

### Producing ADC

```sh
gcloud auth application-default login
# optional, but recommended — see "Quota project" below
gcloud auth application-default set-quota-project MY_PROJECT_ID
```

The file is written to:

- macOS / Linux: `~/.config/gcloud/application_default_credentials.json`
- Windows: `%APPDATA%\gcloud\application_default_credentials.json`

In the file picker on macOS, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> to
show hidden folders like `.config`, or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>
and type the path.

`gcloud auth application-default login` grants the `cloud-platform` scope by
default; that's what the app needs. If you ran it with a narrower
`--scopes`, run it again without. Re-running login (or `revoke`) invalidates
the old refresh token — load the new file into the app again.

### Quota project (user credentials)

With user credentials, Cloud Resource Manager and Secret Manager bill the
call to a *quota project*. The app sends the file's `quota_project_id` as the
`x-goog-user-project` header. Without one you may see "Your application is
authenticating by using local Application Default Credentials … requires a
quota project". Fix with `gcloud auth application-default set-quota-project
PROJECT_ID` and reload the file. You need `serviceusage.services.use`
(`roles/serviceusage.serviceUsageConsumer`) on that project. Service account
keys don't need this.

## Roles per view

Grant these on the project (or a folder/organization above it). Predefined
roles are listed; a custom role with just the listed permissions works too.

| View / action | Role | Key permissions |
| --- | --- | --- |
| Project picker | `roles/browser` (or any role with the permission) | `resourcemanager.projects.get` — the project list shows every project where you have it |
| VM instances — list, details | `roles/compute.viewer` | `compute.instances.list`, `compute.instances.get` |
| VM instances — start / stop / reset | `roles/compute.instanceAdmin.v1` | `compute.instances.start`, `.stop`, `.reset` |
| VM instances — serial port output | `roles/compute.instanceAdmin.v1` | `compute.instances.getSerialPortOutput` (not in compute.viewer) |
| Instance groups — list, members | `roles/compute.viewer` | `compute.instanceGroups.list`, `compute.instanceGroupManagers.list`, `compute.instanceGroups.get` |
| Secrets — list secrets and versions | `roles/secretmanager.viewer` | `secretmanager.secrets.list`, `secretmanager.versions.list` |
| Secrets — Reveal / copy a value | `roles/secretmanager.secretAccessor` | `secretmanager.versions.access` |

Notes:

- `roles/secretmanager.secretAccessor` can be granted on a single secret
  instead of the whole project, so a credential can see only the values it
  should. Listing still needs `secretmanager.viewer` at the project.
- A service account with no project-level `resourcemanager.projects.get`
  still works in the project named in its key (`project_id`) — the picker
  offers that project even if it can't list any.
- `roles/viewer` (basic Viewer) covers every read-only row above except
  revealing secret values; it does not allow start/stop/reset.
- Each API must be enabled in the project: Compute Engine API
  (`compute.googleapis.com`), Secret Manager API
  (`secretmanager.googleapis.com`), and Cloud Resource Manager API
  (`cloudresourcemanager.googleapis.com`) — the last one in the quota project
  for user credentials, or the service account's own project. A disabled API
  shows as an error naming it.

### Example: a read-only service account

```sh
PROJECT=my-project
SA=cloud-console-viewer
gcloud iam service-accounts create $SA --project $PROJECT
for role in roles/browser roles/compute.viewer roles/secretmanager.viewer; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member "serviceAccount:$SA@$PROJECT.iam.gserviceaccount.com" --role $role
done
gcloud iam service-accounts keys create key.json \
  --iam-account "$SA@$PROJECT.iam.gserviceaccount.com"
```

Load `key.json` in the app, then delete it from disk. Add
`roles/compute.instanceAdmin.v1` for start/stop/reset, and
`roles/secretmanager.secretAccessor` for revealing values. Some organizations
block key creation (`iam.disableServiceAccountKeyCreation`); use ADC then.

## Hosts contacted

`oauth2.googleapis.com` (tokens), `cloudresourcemanager.googleapis.com`,
`compute.googleapis.com`, `secretmanager.googleapis.com`. The extension
manifest needs these as host permissions.
