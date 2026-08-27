# cli-blueprint

Install and run the Blueprint skill from [CLI.Tax](https://cli.tax/blueprint).

```bash
npx cli-blueprint@latest install
```

Installs the Blueprint skill into the current IDE skills directory
(`$CODEX_HOME/skills/blueprint`, falling back to `.codex/skills/blueprint`),
so the IDE agent can discover the protocol and compile goals into
implementation-ready engineering blueprints.


也可以直接从 CLI.Tax 对象存储安装（与站点「安装命令」一致）：

```bash
npx https://cli.tax/cli-downloads/clitax-wvz6zmRWmX.tgz install
```

Source: https://github.com/88208555/blueprint-clitax.git

The live endpoint is `https://cli.tax/wvz6zmRWmX` and speaks
`blueprint.skill.request/1.0`.
# marker

Feedback: the skill detail page's "Usage reviews" tab supports like / dislike / daily chat. Likes and dislikes count toward the market reputation (daily marquee cleanup); daily chat messages are kept for 7 days.
