# 高德标注 + Google 卫星图完美贴合：一个坐标系转换的踩坑实录

## 故事情节

事情是这样的——我做了个卫星地图小工具，底图用的是 Google 卫星影像，想在上面叠一层高德的地名标注，这样看地图就知道"这里是北京"、"那里是上海"。

听起来很简单对吧？两个图层叠一起就行。

然而实际效果是这样的：**地名和地图对不上**。明明标的是"天安门"，但文字偏了好几百米，跑到隔壁街区去了。

## 为什么会偏移？

原因很简单：**两家用的坐标系不一样**。

- **Google 卫星图**用的是 **WGS-84**，也就是 GPS 原始坐标系
- **高德地图**用的是 **GCJ-02**，俗称"火星坐标系"

GCJ-02 是中国国家测绘局要求的一种加密坐标系，就是在 WGS-84 的基础上加了一层非线性的偏移。偏移量不是固定的，在中国境内大概是 100～500 米不等。

所以当你把两个图层直接叠在一起，文字就会"飘"——往某个方向偏了一截。

## 最终方案：CSS Transform 像素偏移

经过各种尝试（逐瓦片坐标转换、自写转换函数等），最终找到一个**简洁、可靠、易维护**的方案：

> 不改瓦片内容，不改请求地址，只在显示时用 CSS 平移整个标注图层。

核心代码只有十几行：

```javascript
function updateLabelsOffset() {
  // 1. 获取地图中心点（WGS-84 坐标）
  const center = map.getCenter()

  // 2. 把 WGS-84 坐标转成 GCJ-02
  const [gcjLng, gcjLat] = gcoord.transform(
    [center.lng, center.lat],
    gcoord.WGS84,
    gcoord.GCJ02
  )

  // 3. 分别算出两个坐标在屏幕上的像素位置
  const wgsPt = map.latLngToContainerPoint(L.latLng(center.lat, center.lng))
  const gcjPt = map.latLngToContainerPoint(L.latLng(gcjLat, gcjLng))

  // 4. 用 CSS transform 把高德图层平移到正确位置
  const container = labelsLayer.getContainer()
  container.style.transform = `translate(${wgsPt.x - gcjPt.x}px, ${wgsPt.y - gcjPt.y}px)`
}
```

## 分步拆解

### 第一步：搞清楚偏移方向

一开始我犯了个经典错误——把转换方向搞反了：

```javascript
// ❌ 错误：把 WGS-84 当成 GCJ-02 去转
gcoord.transform([lng, lat], gcoord.GCJ02, gcoord.WGS84)

// ✅ 正确：把 WGS-84 转成 GCJ-02
gcoord.transform([lng, lat], gcoord.WGS84, gcoord.GCJ02)
```

逻辑是：**地图中心是 WGS-84 的，高德是 GCJ-02 的**。我们需要知道"这个 WGS-84 位置在高德的坐标系里对应哪个点"，所以要把 WGS-84 → GCJ-02。

### 第二步：像素位置对比

拿到两组坐标后，用 Leaflet 的 `latLngToContainerPoint` 把它们都转成屏幕像素坐标。两个点的像素差，就是高德图层需要平移的距离。

### 第三步：CSS 平移

最后用 `transform: translate(dx, dy)` 把高德图层整体平移。Leaflet 的每个图层都有一个独立的 DOM 容器，直接操作 `style.transform` 就行。

### 第四步：实时更新

地图每次拖动或缩放后，都要重新计算偏移。因为地图移动时，同一个中心点对应的像素位置会变：

```javascript
map.on('moveend', updateLabelsOffset)
map.on('zoomend', updateLabelsOffset)
```

## 为什么选这个方案？

我试过三种方案，最后选了第三种：

| 方案 | 做法 | 结果 |
|------|------|------|
| 逐瓦片坐标转换 | `createTile` 里把 WGS-84 瓦片坐标转成 GCJ-02 再请求 | 偏移了，因为高德瓦片内部内容本身就是 GCJ-02 坐标 |
| CSS 整体偏移（自写函数） | 自己实现 GCJ-02 转换 + CSS transform | 偏移了，因为自写的转换函数精度不够 |
| **CSS 整体偏移（gcoord 库）** | 用成熟的 gcoord 库做转换 + CSS transform | **完美对齐** |

核心区别是用了 **gcoord** 这个库。它是一个 3.3k stars 的坐标转换库，实现了国标算法，精度远超手写版本。

```bash
npm install gcoord
```

```javascript
import gcoord from 'gcoord'

// WGS-84 → GCJ-02
const [gcjLng, gcjLat] = gcoord.transform([wgsLng, wgsLat], gcoord.WGS84, gcoord.GCJ02)

// GCJ-02 → WGS-84
const [wgsLng, wgsLat] = gcoord.transform([gcjLng, gcjLat], gcoord.GCJ02, gcoord.WGS84)
```

## 踩坑总结

1. **坐标方向不要搞反**：WGS-84 → GCJ-02 和 GCJ-02 → WGS-84 是两个不同的方向，搞反了偏移会加倍而不是消除
2. **不要自己写转换函数**：GCJ-02 的加密算法涉及椭球参数、三角函数迭代，手写很容易出精度问题。用 gcoord 这种成熟库
3. **不要逐瓦片转换坐标**：高德瓦片内部的像素内容就是 GCJ-02 坐标的，你换掉请求地址没用，得整体平移
4. **记得实时更新**：地图一动，偏移量就变了，必须在 moveend/zoomend 里重新计算

## 完整依赖

```json
{
  "leaflet": "^1.9.4",
  "gcoord": "^1.0.7"
}
```

整个方案零侵入——不改高德瓦片的请求逻辑，不改 Leaflet 的渲染流程，只是在图层容器上加了一个 CSS transform。干净、可靠、好维护。
