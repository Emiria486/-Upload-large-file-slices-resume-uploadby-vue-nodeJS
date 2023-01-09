const http = require("http");
const path = require("path");
const fse = require("fs-extra");
// 用于解析formdata的插件
const multiparty = require("multiparty");
const server = http.createServer();
// 大文件存储目录
const UPLOAD_DIR = path.resolve(__dirname, "..", "target");
// 提取后缀名
const extractExt = (filename) => {
  return filename.slice(filename.lastIndexOf("."), filename.length);
};
//对前端发起的合并请求的处理函数
const resolvePost = (req) =>
  new Promise((resolve) => {
    let chunk = null;
    // data是一个buffer数组
    req.on("data", (data) => {
      chunk = data;
    });
    req.on("end", () => {
      // 将请求body中的buffer数组进行解析
      resolve(JSON.parse(chunk));
    });
  });
// 返回已上传的所有切片文件数组
const createUploadList = async (filename) => {
  // 假如切片文件夹创建成功
  if (fse.existsSync(path.resolve(UPLOAD_DIR, "chunkDir" + "_" + filename))) {
    return await fse.readdir(
      // 读取返回切片文件数组
      path.resolve(UPLOAD_DIR, "chunkDir" + "_" + filename)
    );
  } else {
    // 不存在返回空数组
    return [];
  }
};
// 写入文件并删除对应的文件切片流函数
const pipeStream = (path, WriteStream) =>
  new Promise((resolve) => {
    //  读入path路径的文件
    const readStream = fse.createReadStream(path);
    //监听文件读取完毕，会自动触发一次end事件，没有读取完是不会触发的
    readStream.on("end", () => {
      // 同步删除路径的文件切片
      fse.unlinkSync(path);
      resolve();
    });
    // 向writeStream中流式写入切片文件数据
    readStream.pipe(WriteStream);
  });
//   每合并一个文件切片在pipeStream函数中删除对应的文件切片
const mergeFileChunk = async (filePath, filename, size) => {
  // 切片文件们的所在目录
  const chunkDir = path.resolve(UPLOAD_DIR, `chunkDir_${filename}`);
  // 得到目录里面的所有文件
  const chunkPaths = await fse.readdir(chunkDir);
  // 根据切片下标进行排序，否则直接读取目录获得的顺序会错乱
  chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);

  await Promise.all(
    // 对排好序的文件数组调用用pipeStream函数，chunkPath是单个的切片文件路径
    chunkPaths.map((chunkPath, index) =>
      pipeStream(
        path.resolve(chunkDir, chunkPath),
        //   根据size在指定位置创建可写流
        fse.createWriteStream(filePath, {
          start: index * parseInt(size),
        })
      )
    )
  );
};
// 受到request后的响应处理函数
server.on("request", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.status = 200;
    res.end();
    return;
  }
  // 前端将将全部文件切片上传完后发送合并通知，这是合并通知的处理函数
  if (req.url === "/merge") {
    // 获取body中携带的数据
    const data = await resolvePost(req);
    // 得到发送的的文件名和切片固定大小
    const { filename, size, fileHash } = data;
    // 获取拓展名
    console.log("filename, size, fileHash", filename, size, fileHash);
    const ext = extractExt(filename);
    // 生成文件路径名称
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    // 调用合并文件函数
    await mergeFileChunk(filePath, filename, size);
    res.end(
      JSON.stringify({
        code: 0,
        message: "file merged success",
      })
    );
  }
  // 文件秒传对应的接口
  if (req.url === "/verify") {
    const data = await resolvePost(req);
    const { fileHash, filename } = data;
    const ext = extractExt(filename);
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`);
    // 判断文件是否存在
    if (fse.existsSync(filePath)) {
      // 文件存在通知不上传
      res.end(JSON.stringify({ shouldUpload: false }));
    } else {
      // 文件不存在就通知上传
      res.end(
        JSON.stringify({
          shouldUpload: true,
          //并把已上传的文件切片返回给前端
          uploadedList: await createUploadList(filename),
        })
      );
    }
  }
  const multipart = new multiparty.Form();
  //   接受body中的formData文件切片
  // 在 multiparty.parse 的回调中，files 参数保存了 formData 中文件，fields 参数保存了 formData 中非文件的字段
  multipart.parse(req, async (err, fields, files) => {
    if (err) {
      return;
    }
    const [chunk] = files.chunk;

    const [hash] = fields.hash;
    // 计算文件内容得到的hash
    const [fileHash] = fields.fileHash;
    const [filename] = fields.filename;
    //   创建临时文件夹用于临时存储chunk
    // 添加chunkDir和文件名做区分
    const chunkDir = path.resolve(UPLOAD_DIR, "chunkDir" + "_" + filename);
    if (!fse.existsSync(chunkDir)) {
      // 创建切片文件文件夹
      await fse.mkdirs(chunkDir);
    }
    //移动文件到临时文件夹
    await fse.move(chunk.path, `${chunkDir}/${hash}`);
    res.end("received file chunk");
  });
});
server.listen(3000, () => console.log("listening port 3000"));
