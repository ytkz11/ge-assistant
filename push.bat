@echo off
cd /d G:\code\ge-assistant
git add .
git commit -m "update: %date% %time:~0,5%"
git push
echo Done.
pause
