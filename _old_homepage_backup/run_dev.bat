@echo off
chcp 65001 > NUL
cd /d "%~dp0"

echo [1/3] 프론트엔드 서버를 새 창에서 시작합니다...
start "Frontend Client" cmd /k "cd client && npm run dev"

echo [2/3] 서버가 준비될 때까지 3초 대기합니다...
ping 127.0.0.1 -n 4 > nul

echo [3/3] 로컬 홈페이지(http://localhost:4000)를 엽니다...
start http://localhost:4000

echo ===========================================================
echo [백엔드 서버] 이곳에서 백엔드가 실행됩니다. (에러 확인용)
echo ===========================================================
cd server
npm start

echo 백엔드 서버가 종료되었습니다. 에러 메세지를 확인해주세요.
pause