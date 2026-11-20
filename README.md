# GE Satellite Assistant

在浏览器中查看历史卫星影像、切换时间和框选导出。地图支持 OpenStreetMap 底图及高德中文地名叠加。

[打开 GitHub Pages](https://ytkz11.github.io/ge-assistant/)

## 查询与导出

1. 选择 **Esri Wayback**，加载发布目录后选择版本。目录日期是 Esri 的发布日期，实际拍摄时间取决于位置。选择 **Google Earth** 时，查询返回当前地图中心瓦片在当前缩放级别的历史日期。
2. 使用日期列表或时间滑块切换 Wayback 预览，或选择要导出的 Google Earth 历史日期。Google Earth 模式的地图用作选区底图。选择 **框选下载**，拖动地图上方的选区覆盖层。
3. 选择缩放级别和格式。GeoTIFF 保留数据源原生坐标系，Google Earth 为 EPSG:4326，Esri Wayback 为 EPSG:3857。PNG 保存图像像素。两种格式都以所选区域覆盖的整块瓦片为边界。
4. 默认要求所有瓦片加载成功。允许部分导出时，缺失瓦片保留透明。Google Earth 历史导出可显式启用最近日期替补，完成后会显示替补块数。单次导出最多 256 块瓦片、单边最多 8192 像素。

导出需要先选择历史日期或 Wayback 发布版本。Google Earth 导出使用 Time Machine 索引和原始影像瓦片，Google Maps 底图仅用于定位。导出保留数据源瓦片中已有的内容。

GitHub Pages 直接从浏览器请求影像服务。Google Earth 的历史查询和导出可能受跨域策略影响，本地 Vite 提供开发代理。在线使用时可选 Esri Wayback。

## 开发与部署

推荐使用 Node.js 22。

```sh
npm ci
npm test
npm run dev
npm run build
```

GitHub Actions 在拉取请求上运行测试和构建，推送到 `master` 时还会发布到 GitHub Pages。仓库的 **Settings → Pages → Build and deployment → Source** 使用 **GitHub Actions**。构建后的静态文件位于 `dist/`。

日期查询、瓦片拼接和地理配准的功能设计参考 [GEHistoricalImagery](https://github.com/Mbucari/GEHistoricalImagery)。
