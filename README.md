# GE Satellite Assistant

在浏览器中查看 Esri Wayback 历史影像，并按选区导出 Esri Wayback 或 Google Earth Time Machine 影像。地图支持 OpenStreetMap 底图和高德中文地名叠加。

[在线使用](https://ytkz.tech/ge-assistant/)

## 选择影像源

| 影像源 | 如何选择日期 | 地图预览 | GeoTIFF 坐标系 |
| --- | --- | --- | --- |
| **Esri Wayback**（默认） | 点击「加载 Wayback 发布目录」，选择一个发布版本。实际拍摄时间随位置变化。 | 可切换版本并调节历史图层透明度。 | EPSG:3857（Web Mercator） |
| **Google Earth** | 将目标移到地图中心，缩放至所需级别，点击「查询地图中心的历史日期」。结果对应当前中心瓦片与缩放级别。 | 地图作为选区底图，所选日期用于导出。 | EPSG:4326（WGS 84） |

## 框选下载

1. 选定 Wayback 发布版本或 Google Earth 历史日期。
2. 点击「框选下载」，用鼠标或触屏在地图上拖出矩形。
3. 点击「选择下载参数」，检查瓦片数和像素尺寸，选择导出缩放级别与格式。**GeoTIFF** 包含地理参考，可在 GIS 软件中按坐标打开。**PNG** 保存图像像素。两种格式均按覆盖选区的整块瓦片拼接。
4. 点击「开始下载」。默认要求全部瓦片加载成功。勾选「允许缺失瓦片保留透明」可导出有部分覆盖的影像。Google Earth 还可启用最近日期替补，完成后页面会显示实际导出和替补的瓦片数。

单次导出最多 256 块瓦片，单边最多 8192 像素。范围过大时，可缩小选区或降低导出级别。

### 影像日期与瓦片字样

Google Earth 的日期查询针对地图中心的一块瓦片。较大的选区或不同导出级别可能包含缺少该日期的瓦片。

Google Earth 导出通过 Time Machine 索引获取原始影像瓦片。Google Maps 底图用于定位，导出会保留数据源瓦片中已有的标记。如果浏览器无法访问 Google Earth 历史服务，可以尝试 Esri Wayback，或通过本地 Vite 开发代理使用 Google Earth。

## 开发与部署

项目使用 Vue 3、Vite、Leaflet 和 GeoTIFF.js。推荐使用 Node.js 22。

```sh
npm ci
npm test
npm run dev
```

本地开发地址为 [http://localhost:3000/ge-assistant/](http://localhost:3000/ge-assistant/)。运行 `npm run build` 会将静态文件输出到 `dist/`。

GitHub Actions 在拉取请求上运行测试和构建，推送到 `master` 后自动发布到 GitHub Pages。仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

## 参考项目

Google Earth 历史瓦片查询、下载和原生坐标系的实现参考 [GEHistoricalImagery](https://github.com/Mbucari/GEHistoricalImagery)。
