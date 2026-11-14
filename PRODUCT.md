# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要使用者是獲授權的資料收集操作者，負責建立及核准來源設定、執行受控收集和排查問題。維護者需要沿著 Job、Profile Version、Record 和 Evidence 追查結果。FYP 組員以可重現的本機流程示範及評估系統。

## Product Purpose

Adaptive Scalable and Observable Web Data Collection Platform 將獲准的 HTML 和 CSV 轉成經驗證、可追溯的結構化紀錄。通用 Core 可供獨立應用重用，操作者可知道用了哪個來源、設定版本和證據，也可辨識部分成功及失敗。

## Operating Context

- Source 的存取授權與 Profile Version 的擷取核准各自管理。Profile 流程為 Draft → Preview → Validate → Approve。核准是明確操作。
- Job 固定使用特定 Profile Version。查看執行事件、有效紀錄、quarantine 和 Evidence Metadata 是追查問題的主要方式。
- 控制台提供 Overview、New Collection、Sources、Collection Jobs 及 Data Explorer。操作狀態以 API 和已驗證的執行證據為準。

## Stack

React／TypeScript 前端配合 FastAPI、Pydantic、SQLAlchemy、Alembic、PostgreSQL、Scrapling、Redis 及 Celery。團隊以 Windows 11 和接近零預算開發。前端提供本機字型 fallback。

## Capabilities and Constraints

- 已有 Source／Profile、Job、Record、quarantine 和 Evidence Metadata API，Job 由 Dispatcher 派送至 Celery Worker。
- Core 採可信本機模式。HTML 來源限 loopback 和已隔離的 Compose fixture，CSV 輸入限已授權的 dataset。Approval 的 operator 欄位供本機 audit。
- PostgreSQL 保存 metadata 與 lineage，原始證據檔案保留在本機 storage。UI 顯示可用的 metadata，並依現有 API 支援決定可提供的動作。
- ML／Sentiment 及 IA／KOL 為獨立下游工作。IA 平台、資料來源和 matching requirements 尚待確認。

## Evidence on Hand

- [M1 Collection Core contracts](docs/contracts/M1-collection-core.md)
- [M2 REST API contracts](docs/contracts/M2-api-contracts.md)
- [M2 persistence architecture](docs/architecture/M2-persistence-architecture.md)
- [M2 verification and outstanding checks](docs/experiments/M2-readiness-review.md)

## Product Principles

- 將 access policy、核准版本和來源證據呈現在需要做決定的位置。
- 保留真實的部分成功、失敗、未知及不可用狀態。只有在現有 API 支援時才顯示相關操作。
- 優先使用清楚的狀態名稱、可掃讀的表格和可預測的鍵盤操作。
