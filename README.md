# GlobalGuard 跨境图文合规智能体

AI+跨境黑客松巅峰赛 · AI智能上新 · 队伍：还差two dollars的Token

当前为可本地运行的复赛 MVP。已实现 `Route → Detect → Explain → Fix → Recheck` 的发布前风险辅助链路、三市场事实契约、像素修复、审计导出、验证中心和人工盲标工作台；**不是法律认证，不承诺平台批准，也不把合成验证外推为真实商品准确率。**

## 本地运行

需要 Node.js 20 或更高版本，无运行时第三方依赖：

```sh
npm --prefix app start
```

打开 `http://127.0.0.1:4173/`。无密钥也可使用本地规则模式；六张许可照片见 `/samples.html`。

```sh
npm --prefix app test
npm --prefix app run evaluate
npm --prefix app run verify:demo
```

测试默认不调用收费模型。2026-09-12最终包复验结果为103/103自动测试、24/24规则回归、27/27三市场结构契约、90/90确定性对抗变体和22项隔离浏览器检查通过。上述结果证明当前工程与结构边界，不代表真实商品准确率、法律正确率或平台审核通过率。浏览器验证需另有本机 Chrome 和 Playwright，详见 [应用说明](app/README.md)。

## 模型与秘密

仅在本机创建 `app/.env.local`，字段参考 [配置示例](app/.env.example)。真实密钥、环境文件、私人赛事授权原图和临时运行产物不进入仓库。换电脑后需要自行重新配置密钥，GitHub 备份不能恢复秘密。

本队已有赛事专用后端使用授权，见 [授权摘要](app/docs/赛事模型使用授权-2026-09-04.md)。配置中的授权开关不是授权本身；其他使用者不能凭本仓库取得同等权限。尚未公开部署评委 Demo。

## 评委入口

- [应用代码与运行说明](app/README.md)
- 本地验证中心：启动后访问`http://127.0.0.1:4173/validation.html`
- 基础人工盲标：启动后访问`http://127.0.0.1:4173/annotation.html`
- 鲁棒性盲标：启动后访问`http://127.0.0.1:4173/annotation.html?dataset=robustness-v1`
- [真实照片来源和许可](app/docs/真实照片素材库-2026-09-04.md)
- [复赛提交说明](deliverables/GlobalGuard_复赛提交说明.md)

本仓库代码未另行授予开源许可证，公开仅用于赛事评审与项目展示；第三方照片按逐图注明的 CC0 / CC BY-SA 4.0 许可使用，保留作者、来源、许可和改动说明，不暗示品牌合作。
