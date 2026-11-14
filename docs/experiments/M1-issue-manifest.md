# M1 Local Issue Manifest

基線為 `a85f5de`，新分支為 `feature/M1-generic-collection-core`。Git 沒有 remote，GitHub Issues、Project 和 PR 待遠端設立後同步。

| Issue | 交付及驗收測試 | 本機進度 |
| --- | --- | --- |
| M1-01 Versioned Source and Profile Contracts | Pydantic contracts、版本及 enum 拒絕測試、canonical hash 測試 | Batch A 通過 |
| M1-02 Source Profile Lifecycle | Draft 編輯、validation snapshot、顯式 approval、retirement、不可變性 | Batch A 單元測試通過，實際預覽與驗證於 Batch D 接入 |
| M1-03 Configurable Scrapling Extraction | CSS／XPath 重用同一 extractor，涵蓋缺失、壞 selector、相對 URL | Batch B 通過 |
| M1-04 CSV Import Adapter | UTF-8、column mapping、size limit、invalid rows、row positions | Batch B 通過 |
| M1-05 Shared Validation and Deduplication | Typed payload、錯誤原因、run-local dedup 和 identity fallback | Batch C 通過 |
| M1-06 Evidence and Provenance | 原始 bytes、hash、存取與完整性、跨 run 避免覆寫 | Batch C 通過 |
| M1-07 Controlled Collection Runner | 授權 gate、受控 HTTP、CSV、structured run failures | Batch D 通過 |
| M1-08 End-to-End Testing and M2 Readiness | M0 regression、M1 E2E、Ruff、文件及 readiness | Batch E 通過，詳見 [Readiness](M1-readiness-review.md) |
