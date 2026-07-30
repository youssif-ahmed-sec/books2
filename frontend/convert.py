import re
import os

def convert_html_to_jsx(html):
    # Convert class to className
    jsx = html.replace('class=', 'className=')
    # Self-closing tags (img, input, hr, br)
    jsx = re.sub(r'<img([^>]*?)(?<!/)>', r'<img\1 />', jsx)
    jsx = re.sub(r'<input([^>]*?)(?<!/)>', r'<input\1 />', jsx)
    jsx = re.sub(r'<hr([^>]*?)(?<!/)>', r'<hr\1 />', jsx)
    jsx = re.sub(r'<br([^>]*?)(?<!/)>', r'<br\1 />', jsx)
    
    # Handle style="font-variation-settings: 'FILL' 1;"
    jsx = jsx.replace("style=\"font-variation-settings: 'FILL' 1;\"", "style={{ fontVariationSettings: \"'FILL' 1\" }}")
    
    # Comments
    jsx = jsx.replace('<!--', '{/*').replace('-->', '*/}')
    return jsx

html_file = r'd:\Work\Souod El Shafie 2\stitch_saud_el_shafie_omni_manager\_3\code.html'
with open(html_file, 'r', encoding='utf-8') as f:
    content = f.read()

aside_match = re.search(r'<aside.*?</aside>', content, re.DOTALL)
header_match = re.search(r'<header.*?</header>', content, re.DOTALL)

aside_jsx = convert_html_to_jsx(aside_match.group(0)) if aside_match else ""
header_jsx = convert_html_to_jsx(header_match.group(0)) if header_match else ""

# Write the JSX snippets to a temp file for the LLM to read and use
with open('temp_jsx.txt', 'w', encoding='utf-8') as f:
    f.write("--- ASIDE ---\n")
    f.write(aside_jsx)
    f.write("\n--- HEADER ---\n")
    f.write(header_jsx)

def convert_modal():
    html_file = r'd:\Work\Souod El Shafie 2\stitch_saud_el_shafie_omni_manager\_1\code.html'
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()
    aside_match = re.search(r'<aside.*?</aside>', content, re.DOTALL)
    if aside_match:
        aside_jsx = convert_html_to_jsx(aside_match.group(0))
        aside_jsx = aside_jsx.replace('onclick="window.history.back()"', 'onClick={closeProductModal}')
        aside_jsx = aside_jsx.replace('selected=""', 'defaultValue="some-value"')
        aside_jsx = aside_jsx.replace('readonly=""', 'readOnly={true}')
        aside_jsx = aside_jsx.replace('disabled=""', 'disabled={true}')
        
        with open('temp_jsx_modal.txt', 'w', encoding='utf-8') as f:
            f.write(aside_jsx)
convert_modal()

def convert_modal2():
    html_file = r'd:\Work\Souod El Shafie 2\stitch_saud_el_shafie_omni_manager\_1\code.html'
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()
    asides = re.findall(r'<aside.*?</aside>', content, re.DOTALL)
    if len(asides) > 1:
        aside_jsx = convert_html_to_jsx(asides[1])
        aside_jsx = aside_jsx.replace('onclick="window.history.back()"', 'onClick={closeProductModal}')
        aside_jsx = aside_jsx.replace('selected=""', 'defaultValue="some-value"')
        aside_jsx = aside_jsx.replace('readonly=""', 'readOnly={true}')
        aside_jsx = aside_jsx.replace('disabled=""', 'disabled={true}')
        
        with open('temp_jsx_modal.txt', 'w', encoding='utf-8') as f:
            f.write(aside_jsx)
convert_modal2()

def convert_main():
    html_file = r'd:\Work\Souod El Shafie 2\stitch_saud_el_shafie_omni_manager\_3\code.html'
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()
    main_match = re.search(r'<main.*?</main>', content, re.DOTALL)
    if main_match:
        main_jsx = convert_html_to_jsx(main_match.group(0))
        with open('temp_jsx_main.txt', 'w', encoding='utf-8') as f:
            f.write(main_jsx)
convert_main()

def convert_main4():
    html_file = r'd:\Work\Souod El Shafie 2\stitch_saud_el_shafie_omni_manager\_4\code.html'
    with open(html_file, 'r', encoding='utf-8') as f:
        content = f.read()
    main_match = re.search(r'<main.*?</main>', content, re.DOTALL)
    if main_match:
        main_jsx = convert_html_to_jsx(main_match.group(0))
        with open('temp_jsx_main4.txt', 'w', encoding='utf-8') as f:
            f.write(main_jsx)
convert_main4()
