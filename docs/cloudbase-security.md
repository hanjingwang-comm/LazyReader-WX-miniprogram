# CloudBase security configuration

LazyReader reads and writes private records through authenticated cloud functions. Create these collections before deployment:

`articles`, `folders`, `tags`, `books`, `reading_logs`, `user_settings`

When upgrading an existing environment, create `books` with the same rules and redeploy `libraryService` before enabling the new client. Existing local reading records are linked to book profiles on first launch; the migration keeps their dates, page counts and completion artwork.

For every collection, use creator-only database rules:

```json
{
  "read": "doc._openid == auth.openid",
  "write": "doc._openid == auth.openid"
}
```

Cloud storage paths follow `users/{openid}/sources/...` and `users/{openid}/content/...`. Configure storage rules so authenticated users can only read and write paths beginning with their own OpenID. The client never stores Tencent OCR credentials; configure `TENCENTCLOUD_SECRET_ID`, `TENCENTCLOUD_SECRET_KEY`, and `TENCENTCLOUD_REGION` only in the `extractOcr` cloud-function environment.

The `libraryService` and `extractOcr` functions both obtain `OPENID` from `cloud.getWXContext()` and verify ownership before accessing a document. Database rules remain a second layer of protection for accidental direct client access.
