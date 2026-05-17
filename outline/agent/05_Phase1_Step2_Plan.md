# Phase 1 Step 2: Go Core API 数据库设计与初始化

## 目标
在 Go Core API 中集成 GORM，连接 PostgreSQL 数据库，并设计核心数据表结构（User, Photo, ExifData, FeatureFlag）。

## 预计修改方向
1. **依赖引入**: 在 `go-core/go.mod` 中引入 `gorm.io/gorm` 和 `gorm.io/driver/postgres`。
2. **数据库连接**: 创建 `go-core/database/db.go`，实现 PostgreSQL 的连接池初始化逻辑，读取环境变量中的数据库配置。
3. **模型设计**: 创建 `go-core/models` 目录，定义以下 GORM 模型：
   - `User`: 用户表（ID, Username, Email, PasswordHash, Role）。
   - `Photo`: 照片主表（ID, UserID, OriginalFilename, MinioPath, Status, UploadedAt）。
   - `ExifData`: 照片元数据表（ID, PhotoID, CameraModel, LensModel, FocalLength, Aperture, ShutterSpeed, ISO, ColorSpace）。
   - `FeatureFlag`: 功能开关表（ID, FeatureName, IsEnabled, Description）。
4. **自动迁移**: 在 `go-core/main.go` 中调用 GORM 的 `AutoMigrate` 方法，在服务启动时自动创建或更新数据库表结构。
5. **健康检查增强**: 更新 `/health` 接口，除了返回 API 状态，还返回数据库连接状态。

## 预期结果
重启 `go-core` 容器后，GORM 能够成功连接到 PostgreSQL，并自动创建 `users`, `photos`, `exif_data`, `feature_flags` 四张表。访问 `/health` 接口应返回数据库连接正常的提示。