# 設計と旧版の棚卸し

## 目的

「やるべきことを始めて、続けられる」を助ける。開始への手数を減らし、積み重ねが見える。自分で使って不便を見つけ、直せる構造にする。達成表示で小さく報いるが、連続記録の途切れや未達を責めない。

## 旧版参照

参照commit: `abf6fd2a026de9826beb184a72832b1d50d54ab7`、2026-09-13。
対象：README.md、lib/main.dart、lib/tab_page.dart、lib/focus_timer.dart、lib/editable_stopwatch.dart、lib/data_storage_facade.dart。元コードをコピーせず独立実装。

| 旧版の要素 | リメイク方針 |
|---|---|
| 複数同時計測、メモ | 初期基盤で継承。名前とメモを分離 |
| 色分け・目標進捗・経過時間修正 | 初期基盤で継承。編集画面に集約 |
| 終了中を含めた時間復元 | 初期基盤で継承。操作直後に保存 |
| 並べ替え | 初期基盤は上下ボタン。ドラッグ操作は追加手段として検討 |
| 合計/平均表示 | 合計のみ実装。平均の有用性は実使用で判断 |
| 一括開始/停止/リセット/削除 | 一括停止のみ初期実装。破壊操作は慎重に設計 |
| 固定7タブ | 未実装。名前付きグループへ改善する次段階候補 |
| 名前/時間/稼働/色のソート | 未実装。件数が増えた時の整理として検討 |
| スワイプで色・削除・時間調整 | 可視ボタンへ変更。見つけやすさと誤操作防止を優先 |

## 構造

ビルド不要のES Modules。public/src/model.jsは純粋関数で時刻を引数に受け取る。storage.jsはschema v1の保存契約、app.jsはイベント・DOM、style.cssはデザイン変数。将来必要になった段階でUI・PWA登録・import/exportを個別モジュールへ分割する。汎用プラグイン基盤を先回りで作らない。

状態：`{version:1,timers:[{id,name,memo,color,elapsedMs,startedAt,targetMs}]}`。
動作中の経過時間 = 保存済み累積 + max(0,現在時刻 − 開始時刻)。停止で累積へ確定しstartedAtをnullにする。リセットは停止して0に戻す。目標を超えても計測継続。

現在はDate.now方式。スリープやプロセス終了を挟んだ復元に強いが、時計変更で増減する。将来、単調時計併用と時計異常検知を検討する際も、停止期間・OSスリープ・再起動の契約を先に決める。

永続化は操作単位で検証→保存→画面反映。毎描画の書込みはしない。保存失敗時は状態を更新しない。読めないデータは閲覧専用にして元データの書き出しを可能にする。Web Locksで単一書込み画面を確保し、別画面はstorageイベントで更新する。

PWAは同一バージョンのアプリ一式を事前キャッシュ。更新は待機し、全画面を閉じた後に切替。scopeを含むキャッシュ名で他のPagesアプリを巻き込まない。外部フォント・CDNなし。

## 将来の拡張順序（提案）

1. Claudeによる初版UI/UX・アクセシビリティの完成と実機検証。
2. 名前付きグループ、1件だけ動かす集中モード（同時計測モードとの明確な切替）。
3. セッション履歴・日別集計・CSV。現在の累積から過去日付の履歴を捏造しない。
4. よく使う計測セット、テーマ。必要ならIndexedDBへ移行。

グループを実装する際はschema v2とv1→v2移行テストを用意し、既存記録を「未分類」へ移す。開始停止履歴は別エンティティとして追加する。初期基盤のschemaを将来完成形と扱わない。

## 参考

- [MDN: Offline and background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [GitHub: Custom workflows for Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
