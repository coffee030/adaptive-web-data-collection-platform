# M4 Device and Resource Acceptance

| Evidence | Verified scope | Remaining acceptance |
| --- | --- | --- |
| Chromium 158.0.8127.18 | Closure 通過 78 項 controlled 和 14 項 live Docker tests。本次另通過 10 項 keyboard、表單、polling、Evidence 受控測試。 | 已驗證 Windows Chromium。實體手機與人工 Narrator 驗收待完成。 |
| Playwright Firefox 159.0 | Closure 通過 6 項代表性 live 和 2 項 polling。本次另完成 5 次重現檢查及 2 項 live smoke。 | 保留原始崩潰紀錄及重測結果。 |
| Playwright WebKit 27.2 | Closure 通過 6 項代表性 live 和 2 項 polling。Chromium responsive 測試涵蓋 1440／1280／768／390 px。 | macOS Safari **OUT OF SCOPE／NOT RUN**，依使用者決定移除驗收門檻。實體 iPhone Safari **NOT RUN**。現有測試使用 Windows Playwright 內附引擎。 |
| Docker resource measurements | 隔離 Compose 在總服務限額 1792 MiB 下完成 demo 和 restart。抽樣無 OOM，Docker VM 約 15.56 GiB。 | 實體 8 GB Windows 為 **NOT RUN**。主機服務、VM overhead、paging、同時開啟的 UI 程序及持續可用性待實機驗證。 |

[Original measurements and browser evidence](M4-remediation-test-results.md)

## Firefox Page crashed investigation

- 檢查原始 `frontend/test-results/closure-acceptance-firefox/` 的 error context 和 `trace.zip`。`closure.integration.ts:117` 呼叫 `AxeBuilder.runPartialRecursive` 時，`frame.evaluate` 回報 `Page crashed`。Evidence 頁面與 metadata 的 API 回 200，hash 已可見，兩個直接 Host／Origin 請求均回 403。封存 trace 沒有 minidump 或 native crash signature，本機預設 Firefox crash-report 位置未找到匹配檔案。Native crash、資源壓力及應用是否觸發皆未確定。
- 歷史 Firefox 代表性 suite 重跑 6／6 通過。本次以 retries disabled、traces enabled 依序重跑該案五次，5／5 通過；另跑兩項完整 live closure smoke，2／2 通過，包含第六次 Evidence 案例。環境為 Windows、Firefox 159.0、Playwright 1.65.0 及隔離 `collection-m3-test-final-gate` 的 PostgreSQL、Redis、worker。證據位於 Git 忽略的 `frontend/test-results/final-gate-firefox` 和 `final-gate-firefox-smoke`。 [驗收測試命令](M4-remediation-test-results.md#final-gate-補充核對)
- 這次有限的重現檢查未確認可重現的缺陷。若再次發生，建立 issue 並附 browser/build、重現頻率、trace 與可取得的 crash ID 或 dump。比較執行 axe 前後，並區分新瀏覽器啟動及服務變更的影響。

## Explicit device decision

使用者因無 Mac 移除 macOS Safari 測試門檻。請分別記錄 **實體 iPhone Safari** 和 **實體 8 GB Windows** 的決定。

- **完成實測後驗收。** iPhone 測 Source、Profile、Job、Records 及 Evidence，需已有獲准的 fixture 部署方式，並維持 trusted operator 邊界，無法操作的流程要如實填寫。8 GB Windows 以平時的開發工具負載跑 Docker demo 及代表性 live workflow，記錄 Windows build、安裝 RAM、pagefile 或記憶體壓力、啟動時間、Job 結果及 OOM。
- **明確接受為 MVP 限制。** 由使用者分別記錄接受項目、原因、日期及承擔的限制，保留 **ACCEPTED LIMITATION — NOT RUN**。仍未決定時維持 **BLOCKED**。

MVP 使用可信本機 console、受控 fixture 與 live offset pagination。Job 狀態更新取決於實際執行時間。Narrator 是獨立人工驗收。 [Narrator procedure](../reviews/M4-narrator-acceptance.md)
