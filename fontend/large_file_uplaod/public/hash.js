/* 
断点续传的原理在于前端/服务端需要记住已上传的切片，这样下次上传就可以跳过之前已上传的部分
前端解决方案：前端使用 localStorage 记录已上传的切片 hash
服务端解决方案：服务端保存已上传的切片 hash，前端每次上传前向服务端获取已上传的切片
hash值不能根据使用文件名 + 切片下标作为切片hash，要根据文件内容生成hash,
*/
/* 
    优化设计：使用web-worker在worker线程计算hash，不会引起UI的阻塞
*/
// 导入文件hash的计算脚本
self.importScripts("./spark-md5.min.js");
// 生成文件hash
self.onmessage = (e) => {
  const { fileChunkList } = e.data;
  const spark = new self.SparkMD5.ArrayBuffer();
  //   文件上传进度
  let percentage = 0;
  //已读取图片数
  let count = 0;
  const loadNext = (index) => {
    const reader = new FileReader();
    // 读取切片文件
    reader.readAsArrayBuffer(fileChunkList[index].file);
    // 文件读取成功的回调函数
    reader.onload = (e) => {
      //已读取图片数增加
      count++;
      spark.append(e.target.result);
      if (count === fileChunkList.length) {
        // 文件切片数组读取完毕就向worker发送消息
        self.postMessage({
          percentage: 100,
          hash: spark.end(),
        });
        // 关闭线程
        self.close();
      } else {
        /* 每计算完一个切片通过 postMessage 向主线程发送一个进度事件，
        全部完成后将最终的 hash 发送给主线程 */
        // 只上传了部分切片文件
        percentage += 100 / fileChunkList.length;
        self.postMessage({
          percentage,
        });
        loadNext(index);
      }
    };
  };
  loadNext(0);
};
