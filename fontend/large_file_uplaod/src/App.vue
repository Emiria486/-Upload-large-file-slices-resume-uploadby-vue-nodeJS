<template>
  <div id="app">
    <fileUpload />
  </div>
</template>

<script>
import fileUpload from "@/components/file_upload.vue";

export default {
  name: "App",
  components: {
    fileUpload,
  },
};
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>
