<template>
  <div>
    <!-- 文件上传按钮 -->
    <div>
      <input type="file" @change="handleFileChange" />
      <el-button @click="handleUpload">上传文件</el-button>
      <el-button @click="handlePause">暂停文件上传</el-button>
      <el-button @click="handleResume">恢复文件上传</el-button>
    </div>
    <!-- 文件hash值计算进度 -->
    <div>
      <div>文件hash值计算进度</div>
      <el-progress :percentage="hashPercentage"></el-progress>
    </div>
    <!-- 文件上传进度条 -->
    <el-progress type="circle" :percentage="fakeUploadPercentage"></el-progress>
    <el-table :data="data">
      <el-table-column
        prop="hash"
        label="chunk hash"
        align="center"
      ></el-table-column>
      <el-table-column label="size(KB)" align="center" width="120">
        <template v-slot="{ row }">
          {{ row.size }}
        </template>
      </el-table-column>
      <el-table-column label="percentage" align="center">
        <template v-slot="{ row }">
          <el-progress
            :percentage="row.percentage"
            color="#909399"
          ></el-progress>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
<script>
// 切片大小 10MB
// the chunk size
const SIZE = 10 * 1024 * 1024;
export default {
  data: () => ({
    container: {
      file: null,
      // 文件哈希值
      hash: "",
      // web-worker线程用于计算文件hash值
      worker: null,
    },
    // 文件hash值计算进度
    hashPercentage: 0,
    // 文件上传请求数组
    requestList: [],
    data: [],
    // 假进度条，点击暂停会取消并清空切片的xhr请求，如果已经上传了一部分，就会有进度条倒退的现象
    fakeUploadPercentage: 0,
  }),
  computed: {
    // 总进度条
    uploadPercentage() {
      if (!this.container.file || !this.data.length) return 0;
      const loaded = this.data
        // 将每一个切片已上传的部分累加除以整个文件的大小，得到当前文件的上传进度
        .map((item) => item.size * item.percentage)
        .reduce((acc, cur) => acc + cur);
      return parseInt(loaded / this.container.file.size).toFixed(2);
    },
  },
  watch: {
    // 当 uploadPercentage 即真的文件进度条增加时，fakeUploadPercentage 也增加，一旦文件进度条后退，假的进度条只需停止即可
    uploadPercentage(now) {
      if (now > this.fakeUploadPercentage) {
        this.fakeUploadPercentage = now;
      }
    },
  },
  methods: {
    // 生成返回文件切片数组
    createFileChunk(file, size = SIZE) {
      // 文件切片数组
      const fileChunkList = [];
      // 切片标志位
      let cur = 0;
      //按照指定大小分割文件并放入文件切片数组
      while (cur < file.size) {
        fileChunkList.push({ file: file.slice(cur, cur + size) });
        cur += size;
      }
      return fileChunkList;
    },
    // 上传切片,同时过滤已上传的切片
    async uploadChunks(uploadedList = []) {
      // 因为要发起多个请求所以这里
      const requestList = this.data
        .filter(({ hash }) => !uploadedList.includes(hash))
        .map(({ chunk, hash, index }) => {
          // 将每一个切片文件对象数组转换为FormData对象
          const formData = new FormData();
          formData.append("chunk", chunk);
          formData.append("hash", hash);
          formData.append("fileHash", this.container.hash);
          formData.append("filename", this.container.file.name);
          return { formData, index };
        })
        // 数组的每一个formData对象发起请求上传文件到服务器
        .map(({ formData, index }) =>
          this.request({
            url: "http://localhost:3000",
            data: formData,
            // 每一个切片文件上传都实现的监听函数部分
            onProgress: this.createProgressHandler(this.data[index]),
            requestList: this.requestList,
          })
        );
      // 并发请求,等待所有都完成（或第一个失败）
      await Promise.all(requestList);
      // 之前上传的切片数量 + 本次上传的切片数量 = 所有切片数量时合并切片
      if (uploadedList.length + requestList.length === this.data.length) {
        await this.mergeRequest();
      }
    },
    // 生成文件hash（web-worker）
    calculateHash(fileChunkList) {
      return new Promise((resolve) => {
        // 添加worker属性
        this.container.worker = new Worker("/hash.js");
        this.container.worker.postMessage({ fileChunkList });
        this.container.worker.onmessage = (e) => {
          const { percentage, hash } = e.data;
          this.hashPercentage = percentage;
          if (hash) {
            resolve(hash);
          }
        };
      });
    },
    // 文件秒传上传前，先计算出文件 hash，并把 hash 发送给服务端进行验证，一旦服务端能找到 hash 相同的文件，则直接返回上传成功的信息即可
    async verifyUpload(filename, fileHash) {
      const { data } = await this.request({
        url: "http://localhost:3000/verify",
        headers: {
          "content-type": "application/json",
        },
        data: JSON.stringify({
          filename,
          fileHash,
        }),
      });
      return JSON.parse(data);
    },
    // 上传按钮点击事件
    async handleUpload() {
      // 假如未读取到文件就终止
      if (!this.container.file) return;
      // 生成文件切片数组
      const fileChunkList = this.createFileChunk(this.container.file);
      // 得到worker计算的hash
      this.container.hash = await this.calculateHash(fileChunkList);
      //得到服务器秒传对比返回消息和已上传文件数组信息
      const { shouldUpload, uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      // 假如服务器已有该文件返回上传成功，并终止后面的上传行为
      if (!shouldUpload) {
        this.$message.success("文件秒传成功");
        return;
      }
      // 给this.data赋值为切片文件和hash值的对象数组
      this.data = fileChunkList.map(({ file }, index) => ({
        // 由文件内容计算得到的hash值
        fileHash: this.container.hash + "-" + index,
        chunk: file,
        index,
        //每个切片文件的大小
        size: file.size,
        // 文件名 + 数组下标
        hash: this.container.file.name + "-" + index,
        // 传输进度，恢复上传返回已上传的切片，所以需要将已上传切片的进度变成100%
        percentage: this.singleProgress(uploadedList, index),
      }));
      // 向服务器上传对象数组
      await this.uploadChunks(uploadedList);
    },
    // 恢复文件上传按钮的点击事件
    async handleResume() {
      // 得到已上传的文件切片数组
      const { uploadedList } = await this.verifyUpload(
        this.container.file.name,
        this.container.hash
      );
      // 调用文件上传接口函数
      await this.uploadChunks(uploadedList);
    },
    // 处理断点上传的单个文件进度条
    singleProgress(uploadedList, index) {
      // 假如之前没有断点文件，后端返回为空
      if (uploadedList) {
        if (uploadedList.includes(index)) {
          return 100;
        }
      } else {
        return 0;
      }
    },
    // 暂停按钮的点击事件
    handlePause() {
      // 调用保存在 requestList 中 xhr 的 abort 方法，即取消并清空所有正在上传的切片
      this.requestList.forEach((xhr) => xhr?.abort());
      this.requestList = [];
    },
    // 监听文件上传进度，item为切片文件部分
    createProgressHandler(item) {
      return (e) => {
        // 文件上传进度等于文件已上传部分和文件总体大小之比
        // 每个切片在上传时都会通过监听函数更新 data 数组对应元素的 percentage 属性，之后把将 data 数组放到视图中展示
        item.percentage = parseInt(e.loaded / e.total) * 100;
      };
    },
    // 接收文件并赋值给data
    handleFileChange(e) {
      // 获取上传的文件
      const [file] = e.target.files;
      if (!file) return;
      // 再一次点击上传文件时清空原来的文件
      Object.assign(this.$data, this.$options.data());
      this.container.file = file;
      console.log(this.container.file);
    },
    // 前端发送额外的合并请求，服务端接受到请求时合并切片
    async mergeRequest() {
      await this.request({
        url: "http://localhost:3000/merge",
        headers: {
          "content-type": "application/json",
        },
        data: JSON.stringify({
          // 一个切片文件的大小
          size: SIZE,
          //文件hash值
          fileHash: this.container.hash,
          // 文件名
          filename: this.container.file.name,
        }),
      });
    },
    // xhr原生封装
    request({
      url,
      method = "post",
      data,
      // 监听upload.onprogress参数，实现上传进度条
      onProgress = (e) => e,
      headers = {},
      requestList,
    }) {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = onProgress;
        xhr.open(method, url);
        Object.keys(headers).forEach((key) =>
          xhr.setRequestHeader(key, headers[key])
        );
        xhr.send(data);
        // XMLHttpRequest请求成功完成时触发
        xhr.onload = (e) => {
          // 将请求成功的xhr从列表中删除
          if (requestList) {
            // 每当一个切片上传成功时，将对应的 xhr 从 requestList 中删除，所以 requestList 中只保存正在上传切片的 xhr
            const xhrIndex = requestList.findIndex((item) => item === xhr);
            requestList.splice(xhrIndex, 1);
          }
          resolve({
            data: e.target.response,
          });
        };
        // 暴露当前xhr给外部
        requestList?.push(xhr);
      });
    },
  },
};
</script>
