import uiautomator2 as u2
import time

d = u2.connect("127.0.0.1:5555")
# 카테고리 화면이라고 가정하고 아우터 클릭 시도
if d(text="아우터").exists:
    d(text="아우터").click()
    time.sleep(2)
    
# 화면에 있는 텍스트들을 전부 출력해본다.
xml = d.dump_hierarchy()
import xml.etree.ElementTree as ET
root = ET.fromstring(xml)
for node in root.iter('node'):
    text = node.attrib.get('text', '')
    if text:
        print("TEXT:", text)
