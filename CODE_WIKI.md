# Code Wiki

## 项目概览

| 属性 | 值 |
|------|-----|
| **项目名称** | 待定义 |
| **仓库地址** | /workspace |
| **许可证** | MIT License |
| **作者** | Andy Ren |
| **创建日期** | 2026-05-03 |
| **当前状态** | 空仓库（仅包含初始配置） |

## 项目架构

### 当前状态

这是一个新初始化的空仓库，目前仅包含以下文件：

```
/workspace
├── .gitignore      # Git忽略规则配置
└── LICENSE          # MIT开源许可证
```

### 预期项目结构

当项目开发时，建议采用以下标准结构：

```
/workspace
├── src/                    # 源代码目录
│   ├── components/         # 组件目录
│   ├── services/           # 服务层
│   ├── utils/              # 工具函数
│   ├── hooks/              # 自定义Hooks
│   ├── types/              # TypeScript类型定义
│   └── index.ts            # 入口文件
├── tests/                   # 测试文件
├── docs/                    # 文档目录
├── config/                  # 配置文件
├── scripts/                 # 构建脚本
├── package.json             # 项目配置
├── tsconfig.json            # TypeScript配置
└── README.md                # 项目说明文档
```

## 模块说明

### 核心模块（待实现）

| 模块 | 职责 | 状态 |
|------|------|------|
| src/ | 核心业务逻辑和组件 | 待实现 |
| tests/ | 单元测试和集成测试 | 待实现 |
| docs/ | 项目文档 | 待实现 |
| config/ | 环境配置管理 | 待实现 |

### 配置文件说明

#### .gitignore
定义了Git版本控制需要忽略的文件和目录，包括：
- 日志文件（*.log）
- 依赖目录（node_modules/）
- 构建产物（dist/, build/, .next/）
- 环境变量文件（.env）
- IDE配置文件（.vscode/）
- 各类缓存目录

#### LICENSE
采用MIT开源许可证，主要条款包括：
- 免费使用、复制、修改和分发软件
- 必须保留版权声明
- 提供源代码的情况下可进行再发布

## 依赖关系

### 当前依赖

项目暂无任何运行时依赖。

### 预期依赖（根据.gitignore推测）

根据 `.gitignore` 配置，项目可能涉及以下技术栈：

| 类型 | 可能的依赖 | 说明 |
|------|----------|------|
| 前端框架 | React/Vue/Next.js/Nuxt.js | Web应用框架 |
| 构建工具 | Vite/Parcel/Webpack | 模块打包 |
| 包管理器 | npm/yarn/pnpm | 依赖管理 |
| 测试框架 | Jest/Mocha | 单元测试 |
| TypeScript | TypeScript | 类型系统 |

## 环境配置

### 开发环境要求

根据 `.gitignore` 中的工具链配置，推荐的开发环境：

- **Node.js**: >= 16.0.0
- **包管理器**: npm >= 8.0.0 / yarn >= 3.0 / pnpm >= 7.0
- **可选**: TypeScript, ESLint, Prettier

### 环境变量

项目支持 `.env` 文件配置，但需确保：
- `.env` 文件已被 `.gitignore` 忽略
- `.env.example` 文件可用于提交到版本控制（模板文件）

## 运行方式

### 项目初始化

```bash
# 克隆仓库
git clone <repository-url>

# 安装依赖
npm install
# 或
yarn install
# 或
pnpm install
```

### 开发模式

```bash
# 启动开发服务器
npm run dev
```

### 构建生产版本

```bash
# 构建项目
npm run build
```

### 代码检查

```bash
# 运行lint
npm run lint

# 运行类型检查
npm run typecheck
```

### 测试

```bash
# 运行测试
npm run test
```

## 代码规范

### 代码风格

建议采用以下代码规范工具：
- **ESLint**: JavaScript/TypeScript代码检查
- **Prettier**: 代码格式化
- **StyleLint**: CSS/SCSS样式检查

### 提交规范

建议使用 Conventional Commits 规范：

```
<type>(<scope>): <subject>

# 类型说明
feat:     新功能
fix:      修复bug
docs:     文档变更
style:    代码格式（不影响功能）
refactor: 重构
test:     测试相关
chore:    构建/工具变更
```

### 分支管理

建议采用 Git Flow 或 GitHub Flow 分支策略：

| 分支类型 | 命名规则 | 说明 |
|---------|---------|------|
| main | main | 主分支，稳定版本 |
| develop | develop | 开发分支 |
| feature | feature/* | 功能分支 |
| hotfix | hotfix/* | 热修复分支 |
| release | release/* | 发布分支 |

## 开发指南

### 添加新模块

1. 在 `src/` 目录下创建对应的模块目录
2. 编写模块代码和单元测试
3. 更新相关配置文件
4. 遵循代码提交规范提交代码

### 添加新依赖

```bash
# 添加生产依赖
npm install <package-name>

# 添加开发依赖
npm install -D <package-name>
```

### 配置检查

在安装新依赖后，确保更新以下文件：
- `package.json` (自动更新)
- `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` (自动更新)
- `.gitignore` (如需忽略新的构建产物)

## 安全建议

### 敏感信息处理

1. **禁止提交密钥和Token**
   - 所有密钥、API Token、私钥等必须存储在 `.env` 文件中
   - `.env` 文件已加入 `.gitignore`，不会被提交

2. **敏感信息检查**
   - 定期使用 `git log` 检查提交历史
   - 如发现敏感信息泄露，立即轮换密钥并从Git历史中移除

3. **环境变量命名规范**
   ```bash
   # 生产环境
   REACT_APP_API_URL=https://api.example.com
   REACT_APP_VERSION=1.0.0
   
   # 本地开发
   REACT_APP_API_URL=http://localhost:3000
   ```

## 故障排除

### 常见问题

| 问题 | 解决方案 |
|------|---------|
| node_modules 安装失败 | 删除 `node_modules` 和锁文件，重新安装 |
| .env 变量不生效 | 确保变量名以 `REACT_APP_` 开头（React项目） |
| 构建失败 | 检查 TypeScript 配置和依赖兼容性 |
| Git 冲突 | 使用 `git stash` 暂存本地更改或手动解决冲突 |

### 日志位置

根据 `.gitignore` 配置，以下日志文件会被忽略：
- `logs/*.log`
- `npm-debug.log*`
- `yarn-debug.log*`
- `yarn-error.log*`

## 版本历史

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v0.1.0 | 2026-05-03 | Andy Ren | 项目初始化，包含基础配置 |

## 贡献指南

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

## 许可证

本项目采用 MIT License - 详见 [LICENSE](LICENSE) 文件

## 联系方式

- **作者**: Andy Ren
- **邮箱**: renxu7255@gmail.com

---

*文档最后更新: 2026-05-05*
