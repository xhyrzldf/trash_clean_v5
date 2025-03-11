#!/usr/bin/env bash
set -e
set -x  # 开启调试模式，显示每个命令

# 获取版本与架构
VERSION="1.0.0"
while getopts "v:" opt; do
  case $opt in
    v)
      VERSION=$OPTARG
      ;;
    *)
      ;;
  esac
done

ARCH=$(dpkg --print-architecture)
PKG_NAME="system_clean_${ARCH}_${VERSION}"

WORKDIR=$(pwd)
export LDFLAGS="$LDFLAGS $(pwd)/warn_stub.o"

# 清理dist目录
echo "清理dist目录..."
rm -rf dist
# 创建必要的子目录
mkdir -p dist/DEBIAN
mkdir -p dist/usr/local/system-clean
mkdir -p dist/usr/local/system-clean/frontend
mkdir -p dist/usr/lib/systemd/system
mkdir -p dist/usr/share/applications
mkdir -p dist/usr/share/pixmaps

# 确认目录创建成功
echo "检查目录结构："
tree dist

# 1. 打包后端 (Nuitka)
echo "打包后端..."
cd backend
/home/matrix/miniforge3/envs/python39/bin/python -m nuitka --follow-imports --standalone --output-dir=dist backend.py
cd "$WORKDIR"

# 确认后端二进制文件存在 - 修改为正确路径
if [ ! -f backend/dist/backend.dist/backend.bin ]; then
  echo "后端二进制文件未找到！"
  exit 1
fi

# 将生成的后端目录放入dist - 修改为正确的源路径
echo "复制后端文件到 dist/usr/local/system-clean/backend/..."
mkdir -p dist/usr/local/system-clean/backend
cp -r backend/dist/backend.dist/* dist/usr/local/system-clean/backend/

# 创建后端启动脚本以便于服务调用
cat > dist/usr/local/system-clean/start_backend.sh <<EOF
#!/bin/bash
cd /usr/local/system-clean/backend
./backend.bin
EOF

chmod +x dist/usr/local/system-clean/start_backend.sh

# 确认复制成功
ls -l dist/usr/local/system-clean/backend/

# 2. 打包前端 (Electron)
echo "打包前端..."
cd electron-frontend

# 确保已安装依赖
cnpm install

# 设置环境变量以确保 electron-builder 使用镜像
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"

# electron-builder 打包 - 使用tar.gz而不是deb
npx electron-builder --linux tar.gz

cd "$WORKDIR"

# 复制前端打包结果到 dist
echo "复制前端打包结果到 dist/usr/local/system-clean/frontend/..."

# 查找tar.gz文件
TARBALL=$(ls electron-frontend/dist/*.tar.gz 2>/dev/null || echo "")

if [ -n "$TARBALL" ]; then
  # 解压tar.gz文件到frontend目录
  echo "找到tar.gz包: $TARBALL，正在解压..."
  mkdir -p temp_frontend
  tar -xzf "$TARBALL" -C temp_frontend --strip-components=1
  cp -r temp_frontend/* dist/usr/local/system-clean/frontend/
  rm -rf temp_frontend
else
  # 如果没有tar.gz文件，检查是否有linux-arm64-unpacked目录
  UNPACKED_DIR="electron-frontend/dist/linux-arm64-unpacked"
  if [ -d "$UNPACKED_DIR" ]; then
    echo "找到unpacked目录: $UNPACKED_DIR，正在复制..."
    cp -r "$UNPACKED_DIR"/* dist/usr/local/system-clean/frontend/
  else
    echo "错误: 既没有找到tar.gz包也没有找到unpacked目录!"
    ls -la electron-frontend/dist/
    exit 1
  fi
fi

# 确认复制成功
ls -l dist/usr/local/system-clean/frontend/

# 创建前端启动脚本 - 使用确定的名称systemclean
cat > dist/usr/local/system-clean/start_frontend.sh <<EOF
#!/bin/bash
cd /usr/local/system-clean/frontend
./systemclean "\$@"
EOF

chmod +x dist/usr/local/system-clean/start_frontend.sh

# 3. 创建 systemd 服务文件 - 修改ExecStart指向启动脚本
cat > dist/usr/lib/systemd/system/system-clean-backend.service <<EOF
[Unit]
Description=System Clean Backend Service
After=network.target

[Service]
ExecStart=/usr/local/system-clean/start_backend.sh
Restart=always
User=root
WorkingDirectory=/usr/local/system-clean/backend

[Install]
WantedBy=multi-user.target
EOF

# 4. 桌面图标与菜单项
echo "复制桌面图标..."
cp electron-frontend/src/icons/app_icon.png dist/usr/share/pixmaps/system-clean.png

echo "创建 system-clean.desktop 文件..."
cat > dist/usr/share/applications/system-clean.desktop <<EOF
[Desktop Entry]
Name=System Clean
Comment=System Clean Utility
Exec=/usr/local/system-clean/start_frontend.sh
Icon=system-clean
Terminal=false
Type=Application
Categories=System;Utility;
EOF

# 5. DEBIAN 控制文件
echo "创建 DEBIAN/control 文件..."
cat > dist/DEBIAN/control <<EOF
Package: system-clean
Version: $VERSION
Architecture: $ARCH
Maintainer: xhyrzldf@gmail.com
Description: 一款系统垃圾清理与优化的小工具
EOF

# postinst 脚本安装后动作：启用并启动服务，更新菜单，设置 chrome-sandbox 权限
echo "创建 DEBIAN/postinst 脚本..."
cat > dist/DEBIAN/postinst <<EOF
#!/bin/sh
set -e

# 注册并启动服务
systemctl daemon-reload
systemctl enable system-clean-backend.service
systemctl start system-clean-backend.service

# 设置 chrome-sandbox 权限和所有权
chown root:root /usr/local/system-clean/frontend/chrome-sandbox
chmod 4755 /usr/local/system-clean/frontend/chrome-sandbox

# 更新桌面数据库/图标缓存（可选）
which update-desktop-database && update-desktop-database || true
which update-icon-caches && update-icon-caches /usr/share/icons/hicolor || true

exit 0
EOF

chmod 755 dist/DEBIAN/postinst

# preinst 如果要处理旧版本的 service 可加
echo "创建 DEBIAN/preinst 脚本..."
cat > dist/DEBIAN/preinst <<EOF
#!/bin/sh
set -e

# 如果已有旧服务，先停掉
if systemctl is-enabled system-clean-backend.service 2>/dev/null; then
  systemctl stop system-clean-backend.service || true
fi

exit 0
EOF

chmod 755 dist/DEBIAN/preinst

# prerm 卸载前停止服务
echo "创建 DEBIAN/prerm 脚本..."
cat > dist/DEBIAN/prerm <<EOF
#!/bin/sh
set -e

if [ "\$1" = "remove" ]; then
  systemctl stop system-clean-backend.service || true
  systemctl disable system-clean-backend.service || true
fi

exit 0
EOF

chmod 755 dist/DEBIAN/prerm

# postrm 卸载后清理
echo "创建 DEBIAN/postrm 脚本..."
cat > dist/DEBIAN/postrm <<EOF
#!/bin/sh
set -e

if [ "\$1" = "purge" ]; then
  # 清理残留数据
  # if any
  :
fi

exit 0
EOF

chmod 755 dist/DEBIAN/postrm

# 6. 打包deb
echo "开始打包 .deb 文件..."
fakeroot dpkg-deb --build dist "$PKG_NAME.deb"

echo "构建完成: $PKG_NAME.deb"