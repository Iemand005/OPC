/*
 * Copyright (c) 2026 Flexan
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/**
 * @param {string} localStorageName The name of the localStorage item to store the memory in.
 * @param {(processor: string, text: string, level: number) => any} logFunction An optional log function.
 */
function newFilesystem(localStorageName, logFunction) {
  const mounts = [];
  let localMem = {};
  let isLocal = false;

  const innerToMem = (local, path) => {
    const k = Object.keys(local);
    let mem = "";
    for (let i = 0; i < k.length; i++) {
      const mm = local[k[i]];
      if (path + k[i] == mounts) continue;
      mem += path + k[i];
      if (typeof mm == "string") {
        mem += ":" + mm + "$";
        continue;
      }
      mem += "$" + innerToMem(mm, path + k[i] + "/");
    }
    return mem;
  };

  const blockedPublic = ["/apps", "/system"];
  const appsallowed = {};
  const fs = {
    /** Disables all permissions. */
    disablePermissions() {
      blockedPublic.length = 0;
    },
    /** Initializes localStorage memory if it isn't initialized yet. */
    prep() {
      if (!this.raw.getMem()) this.raw.alterMem("");
      
      return [true];
    },
    /** Reads from localStorage. */
    toLocal() {
      localMem = {};

      let mem = this.raw.getMem();
      let index = 0;

      while (mem.length > 1 && (index = mem.indexOf("$")) >= 0) {
        let segment = mem.substring(0, index); // File: <address>:<data> -- Dir: <address>
        let isFile = false;
        let data;

        const dataindex = segment.indexOf(":");
        if (dataindex >= 0) {
          isFile = true;
          data = segment.substring(dataindex + 1);
          segment = segment.substring(0, dataindex);
        }

        const address = this.getLocalAddress(segment);
        if (!address[0]) logFunction("fs.toLocal()", address[1], 1);

        mem = mem.substring(index + 1);

        if (isFile) {
          address[1][address[2]] = data;
          continue;
        }
        
        address[1][address[2]] = {};
      }

      isLocal = true;
      return [true];
    },
    /** Writes to localStorage. */
    toMem() {
      const mem = innerToMem(localMem, "/");
      this.raw.alterMem(mem);

      return [true];
    },
    mount: {
      /**
       * Mounts external data to a path. The external data must be in the form of `Folder` where
       * `Folder = {[string fileOrFolderName]: Folder | string}` and the `string` values are Base64-encoded file contents.
       * This format is not checked and it will blatantly accept any format and plop it into the filesystem.
       * I haven't tested this, but if you set `data` to a string, it might just change the mounting directory to a file instead.
       */
      mount(path, data) {
        if (fs.raw.checkIllegal(path)) return [false, fs.raw.illegalMsg];
        path = fs.raw.getPath(path);
        
        if (fs.exists(path)[1]) {
          const id = fs.isDir(path);
          
          if (id[0] && id[1]) {
            const fls = fs.getFiles(path);
            if (!fls[0] || fls[1].length > 0) return [false, "Cannot mount to an existing file/directory."];
          } else return [false, "Cannot mount to an existing file/directory."];
        }

        const dirc = fs.createDirs(path);
        if (!dirc[0]) return dirc;

        const address = fs.getLocalAddress(path);
        if (!address[0]) return address;

        const struct = address[1];
        const name = address[2];
        struct[name] = data;
        mounts.push(path);

        return [true];
      },
      /** Empties a mounted path and returns the data that was in it. The data returned is compatible with `mount`'s `data` parameter. */
      eject(path) {
        if (fs.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];
        path = fs.raw.getPath(path);

        const ind = mounts.indexOf(path);
        if (ind < 0) return [false, "Not a mounted directory."];

        const address = fs.getLocalAddress(path);
        if (!address[0]) return address;

        const struct = address[1];
        const name = address[2];
        const data = struct[name];
        delete struct[name];

        mounts.splice(ind, 1);

        return [true, data];
      },
      /**
       * Returns all the paths that are mounted.
       *
       * @return {string[]} The paths that are mounted.
       */
      getMounts() {
        return [...mounts];
      }
    },
    /**
     * Returns the internal representation of the filesystem for the path.
     * The object is synced and this allows you to perform any operations you wish without calling filesystem methods.
     */
    getLocalAddress(path) {
      if (path == "/") return [true, {root: localMem}, "root"];

      const split = path.split("/");
      if (split[0] != "") return [false, "Invalid relative path found, ignoring: \"" + path + "\""];
      
      let address = localMem;
      for (let i = 1; i < split.length - 1; i++) {
        address = address[split[i]];
        if (address == undefined) return [false, "Directory doesn't exist: \"" + split[i] + "\""]
      }
      
      return [true, address, split[split.length - 1]];
    },
    /** Creates all dirs recursively for a path, e.g. if /test doesn't exist and you enter /test/meow/hi, it'll create all 3 of those dirs. */
    createDirs(path) {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];

      const split = path.split("/");
      if (split[0] != "") return [false, "Invalid relative path found, ignoring: \"" + path + "\""];

      let address = localMem;
      for (let i = 1; i < split.length; i++) {
        if (split[i].trim() == "") continue;

        let o = address[split[i]];
        if (o == undefined) o = address[split[i]] = {};

        address = o;
      }

      return [true];
    },
    /**
     * Creates a file at `path` with contents `data` that are either Base64-encoded or plain text (`isBase64`).
     * This method WILL overwrite existing files.
     */
    createFile(path, data, isBase64) {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];
      if (typeof data == "object") return [false, "Can't write JSON data to files, stringify it instead."];

      const address = this.getLocalAddress(this.raw.getPath(path));
      if (!address[0]) return address;

      const struct = address[1];
      const name = address[2];
      struct[name] = isBase64 ? data ?? "" : btoa(data ?? "");
      this.toMem();

      return [true, name];
    },
    /**
     * Writes a file at `path` with contents `data` that are either Base64-encoded or plain text (`isBase64`).
     * Actually just calls `createFile`, since it overwrites existing files.
     */
    writeFile(path, data, isBase64) {
      return this.createFile(path, data, isBase64);
    },
    /**
     * Creates a dir at `path`.
     * This method WILL overwrite existing directories, meaning they will be CLEARED with NO WAY to restore them!
     * Check if the directory exists first or use `createDirs` instead, which only creates the directory if it doesn't exist.
     * Otherwise, this is a performant way to clear a directory. The root path (/) is the only one immune to this effect, by coincidence.
     */
    createDir(path) {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];

      const address = this.getLocalAddress(this.raw.getPath(path));
      if (!address[0]) return address;

      const struct = address[1];
      const name = address[2];
      struct[name] = {};
      this.toMem();

      return [true];
    },
    /** Deletes the directory/file at `path` recursively. */
    delete(path) {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];

      const address = this.getLocalAddress(this.raw.getPath(path));
      if (!address[0]) return address;

      const struct = address[1];
      const name = address[2];
      delete struct[name];
      this.toMem();

      return [true];
    },
    /** Reads the file at `path` and returns the file contents as either a string or Base64-encoded string (`asBase64`). */
    readFile(path, asBase64) {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];

      const address = this.getLocalAddress(this.raw.getPath(path));
      if (!address[0]) return address;

      const struct = address[1];
      const name = address[2];
      if (struct[name] == undefined) return [false, this.raw.notfoundMsg];
      
      return [true, asBase64 ? struct[name] : atob(struct[name])];
    },
    /** Reads the file at `path` as a blob and returns the blob URL. */
    async readBlob(path, type = "application/octet-stream") {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];

      const address = this.getLocalAddress(this.raw.getPath(path));
      if (!address[0]) return address;

      const struct = address[1];
      const name = address[2];
      if (struct[name] == undefined) return [false, this.raw.notfoundMsg];
      /* https://stackoverflow.com/a/36183085/15390856 */
      const b64toBlob = (base64, type) => fetch(`data:${type};base64,${base64}`).then(res => res.blob())

      return [true, URL.createObjectURL(await b64toBlob(struct[name], type))];
    },
    /**
     * Returns all the files in the directory. It does not check whether the path is a directory or file.
     * As such, giving it a file will return every single index along the content string (so a file with 300 characters returns 300 indexes, ["0", "1", "2", ..., "299"]).
     * To mitigate this, please check whether the path is a directory with `isDir` first.
     */
    getFiles(path) {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];

      const address = this.getLocalAddress(this.raw.getPath(path));
      if (!address[0]) return address;

      const struct = address[1];
      const name = address[2];
      if (struct[name] == undefined) return [false, this.raw.notfoundMsg];

      return [true, Object.keys(struct[name])];
    },
    /** Returns `true` when the `path` is a directory. */
    isDir(path) {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];

      const address = this.getLocalAddress(this.raw.getPath(path));
      if (!address[0]) return address;

      const struct = address[1];
      const name = address[2];
      return [true, typeof struct[name] == "object"];
    },
    /** Returns `true` when the `path` is a directory/file (exists). */
    exists(path) {
      if (this.raw.checkIllegal(path)) return [true, false];

      const address = this.getLocalAddress(this.raw.getPath(path));
      if (!address[0]) return [true, false];

      const struct = address[1];
      const name = address[2];
      return [true, struct[name] !== undefined];
    },
    /** Pops the last file/directory name from the path, giving you the parent path. E.g. /some/test/dir will become /some/test. */
    getParent(path) {
      if (this.raw.checkIllegal(path)) return [false, this.raw.illegalMsg];

      path = this.raw.getPath(path);
      return [true, path.substring(0, path.lastIndexOf("/"))];
    },
    /**
     * Returns `1` when the `path` may be edited or read and returns `0` otherwise.
     * 
     * `package` is optional and may be ommitted. When it isn't, all it does is check whether the path is `/apps/<package>`,
     * in which case it'll allow it (it disallows `/apps/<other package>` unless the package has permission to read/edit it).
     * When providing no `package`, it'll disallow all attempts to read/edit `/apps`.
     * 
     * `type` can either be `"EDIT"` or anything else. `type` is checked against all allowed app directories,
     * which it only checks when `package` is given. The `type` will be checked against the type given to `allowAppDirectoryPerm`.
     * 
     * `.registry` files are always allowed to be read or done things to as long as `type` is not `"EDIT"`. It doesn't matter where that file is,
     * as long as it's a file (not a dir) and it ends in `.registry`. I have no clue why, honestly.
     */
    checkPermission(path, package, type) {
      if (this.raw.checkIllegal(path)) return [true, -1];

      path = this.raw.getPath(path);
      if (path.endsWith(".registry") && !this.isDir(path)[1] && type != "EDIT") return [true, 1];

      if (package && path.startsWith("/apps/")) {
        const i = path.indexOf("/", 6);

        if (path.startsWith("/apps/" + package) || (path.length > 6 && appsallowed[package]?.for == path.substring(6, i < 0 ? undefined : i) && appsallowed[package].type == type)) return [true, 1];
      }

      for (let i = 0; i < blockedPublic.length; i++) {
        if (path == blockedPublic[i] || path.startsWith(blockedPublic[i] + "/")) {
          return [true, 0];
        }
      }

      return [true, 1];
    },
    /** Allows an app's directory to be read/edited (depending on `type`) by another app. */
    allowAppDirectoryPerm(package, forPackage, type) {
      appsallowed[package] = {for: forPackage, type};
      return [true];
    },
    /** Parses a `.registry` file. No idea why it's in fs. Look at the method implementation to see what format they're in. */
    parseRegistry(text) {
      const registry = [];
      const lines = text.split("\n");
      
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() == "" || lines[i].startsWith(";")) continue;
        if (lines[i].startsWith(" ")) lines[i] = lines[i].substring(1);
        registry.push(lines[i].split("\t"));
      }

      return [true, registry];
    },
    raw: {
      getMem() {
        return localStorage.getItem(localStorageName);
      },  
      alterMem(data) {
        return localStorage.setItem(localStorageName, data);
      },
      pushMem(data) {
        return this.alterMem(this.getMem() + data);
      },
      getPath(path) {
        const n = decodeURIComponent(new URL("https://example.com/" + encodeURI(path)).pathname.replace(/\/+(?=\/)/g,'').replace(/\/+$/, ""));
        return n.length == 0 ? "/" : n;
      },
      /** Illegal paths are paths that contain `$`, `:` or `"`. */
      checkIllegal(path) {
        return path.includes("$") || path.includes(":") || path.includes("\"");
      },
      illegalMsg: "The following characters are not allowed: '$', ':', '\"'",
      notfoundMsg: "Not found"
    }
  };
  
  return fs;
}