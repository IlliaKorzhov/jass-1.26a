import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
// const vscode = require("vscode");

const language = "jass";

class JassUtils {
  static content2Lines = (content: string) => {
    let lines: string[] = [];
    let col: string = "";
    for (let i = 0; i < content.length; i++) {
      const c: string = content.charAt(i);
      col += c;
      if (c == "\n") {
        lines.push(col);
        col = "";
      }
    }
    lines.push(col);
    return lines;
  }

  /**
     * 去除单行注释和字符串,不包括单行
     * @param content 
     */
  static removeStringAndBlockComment(content: string): string {
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    let t = "";
    for (let i = 0; i < content.length; i++) {
      const c: string = content.charAt(i);
      const next = () => content.charAt(i + 1);
      const pre = () => content.charAt(i - 1);
      const pre2 = () => content.charAt(i - 2);
      if (c == "/" && next() == "/" && !inString && !inBlockComment) {
        inLineComment = true;
      } else if (c == "/" && next() == "*" && !inString && !inLineComment) {
        inBlockComment = true;
      } else if (c == '"' && !inLineComment && !inBlockComment && !inString) {
        inString = true;
      } else if (c == '"' && inString && pre() != "\\") {
        inString = false;
      } else if (c == "\n") {
        if (inString) inString = false;
        if (inLineComment) inLineComment = false;
      } else if (pre() == "/" && pre2() == "*" && inBlockComment) {
        inBlockComment = false;
      }
      if (inString) t += " ";
      else if (inBlockComment) {
        if (c == "\n") t += c;
        else t += " ";
      }
      else t += c;
    }
    return t;
  }

  /**
   * 去除文本宏，同时去除多行注释和字符串
   * @param content 
   */
  static removeTextMacro(content: string): string {
    const lines = JassUtils.content2Lines(JassUtils.removeStringAndBlockComment(content));
    let inTextMacro = false;
    let str = "";
    const pushNewLine = () => str += "\n";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\/\/!\s+textmacro/.test(line)) {
        inTextMacro = true;
        pushNewLine();
      } else if (/\/\/!\s+endtextmacro/.test(line)) {
        inTextMacro = false;
        pushNewLine();
      } else if (inTextMacro) {
        pushNewLine();
      } else {
        str += line;
      }
    }
    return str;
  }

  static isKeyword(keyword: string): boolean {
    const keywords = ["and", "or", "not", "globals", "endglobals", "function", "endfunction", "constant", "native", "local", "type", "set", "call", "takes", "returns", "extends", "array", "true", "false", "null", "nothing", "if", "else", "elseif", "endif", "then", "loop", "endloop", "exitwhen", "return", "integer", "real", "boolean", "string", "handle", "code"];
    return keywords.includes(keyword);
  }



}

class CommonJ {
  private commonJFilePath: string = path.resolve(__dirname, "../../src/resources/static/jass/common.j");
  private commonJContent: string | null = null;

  private static commonJ: CommonJ | null = null;

  private constructor() {
    this.init();
  }

  /**
   * 初始化時，讀取common.j内容
   */
  private init() {
    if (fs.existsSync(this.commonJFilePath)) {
      this.commonJContent = fs.readFileSync(this.commonJFilePath).toString("utf8")
    }
    if (this.commonJContent) {
      Type.resolveTypes(this.commonJContent, true);
    }
  }

  public setCommonJFilePath(filePath: string): void {
    this.commonJFilePath = filePath;
    this.init();
  }

  public getCommonJFilePath = () => this.commonJFilePath;

  static build() {
    if (!this.commonJ) this.commonJ = new CommonJ;
    return this.commonJ;
  }
}


class Type {
  public name: string | null = null;
  public extends: string | null = null; //  可以为数组对象，目前不进行进一步解析，以string形式保存
  public isArrayObject: boolean = false;
  public size: number = 0; // isArrayObject为true时才有效
  public range: vscode.Range | null = null;
  public nameRange: vscode.Range | null = null;
  public description: string | null = null;

  public constructor(name: string, extend?: string, description?: string) {
    this.name = name;
    if (extend) this.extends = extend;
    if (description) this.description = description;
  }

  public origin(): string {
    return `type ${this.name}${this.extends ? " extends " + this.extends : ""}`;
  }



  /**
   * 记录当前所有类型
   */
  private static Types: Type[] = new Array<Type>();

  /**
   * 返回基本类型和已经识别的类型
   * @param isTake 是否需要code类型
   */
  static types(isTake: boolean = false): Type[] {
    if (isTake) return [...Type.TakeBaseTypes, ...Type.Types];
    else return [...Type.StatementBaseTypes, ...Type.Types];
  }

  /**
   * 往Types中添加type,存在则替换
   * @param type 
   */
  private static push(type: Type): void {
    if (type) {
      let anyMatch = false; // 是否存在能匹配的类型
      for (let index = 0; index < Type.Types.length; index++) {
        const t = Type.Types[index];
        if (t.name == type.name) {
          Type.Types.splice(index, 1, type);
          anyMatch = true;
        }
      }
      if (!anyMatch) {
        Type.Types.push(type);
      }
    }
  }

  /**
   * 返回 a|b|c 这种字符串
   */
  public static types2RegExpString = (types: Type[]): string => types.map(value => value.name).join("|");

  /**
   * 解析type或数组对象
   * @param content 
   * @param isCommonJ true 只解析jass类型，false 只解析数组对象
   */
  static resolveTypes(content: string, isCommonJ: boolean = false): void {
    const jassContent = JassUtils.removeTextMacro(content);
    const lines = JassUtils.content2Lines(jassContent);
    // for内部每解析一个类型都会更新Types
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*type\s+[a-zA-Z]+/.test(line)) {
        const typeRegExp = isCommonJ ? new RegExp(`type\\s+(?<name>[a-zA-Z]+)(\\s+extends\\s+(?<extends>${this.types2RegExpString([Type.Handle, ...Type.Types].filter(value => !value.isArrayObject))}))?`) : new RegExp(`type\\s+(?<name>[a-zA-Z]+)(\\s+extends\\s+(?<extends>(${this.types2RegExpString(Type.types())})\\s+(?<arrayObject>array)\\s*\\[(?<size>[1-9]\\d*)\\]))?`);
        if (typeRegExp.test(line)) {
          let type = null;
          const result = typeRegExp.exec(line);
          if (result) {
            if (result.groups) {
              if (result.groups.name) {
                type = new Type(result.groups.name);
              }
              if (type) {
                if (result.groups.extends) {
                  type.extends = result.groups.extends;
                }
                if (result.groups.arrayObject) {
                  type.isArrayObject = true;
                }
                if (result.groups.size) {
                  const size = Number.parseInt(result.groups.size);
                  if (!Number.isNaN(size) && size > 0) type.size = size;
                }
              }
            }
          }
          if (type) this.push(type);
        }
      }
    }
  }

  static Boolean = new Type("boolean", void 0, "布尔");
  static Integer = new Type("integer", void 0, "整数");
  static Real = new Type("real", void 0, "实数");
  static String = new Type("string", void 0, "字符串");
  static Code = new Type("code", void 0, "回调方法");
  static Handle = new Type("handle", void 0, "句柄");

  static StatementBaseTypes = [Type.Boolean, Type.Integer, Type.Real, Type.String, Type.Handle];
  static TakeBaseTypes = [...Type.StatementBaseTypes, Type.Code];

}

const commonJ = CommonJ.build(); // 单例

class Comment {
  public original: string = "";
  public content: string = "";
  public range: vscode.Range | null = null;
  public contentRange: vscode.Range | null = null;
}

enum Modifier {
  Private = "private",
  Public = "public",
  Common = "common"
}

/**
 * 解析出修饰符
 * @param content 
 */
const resolveModifier = (content: string): Modifier => {
  if (content) {
    if (/\bprivate\b/.test(content)) {
      return Modifier.Private;
    } else if (/\bpublic\b/.test(content)) {
      return Modifier.Public;
    }
    return Modifier.Common;
  }
  return Modifier.Common;
}

/**
 * @deprecated
 */
enum MemberModifier {
  Private = "private",
  Public = "public"
}

class Global {
  public modifier: Modifier = Modifier.Common;
  public isConstant: boolean = false;
  public isArray: boolean = false;
  public type: string | null = null;
  public name: string | null = null;
  public range: vscode.Range | null = null;
  public nameRange: vscode.Range | null = null;
  public origin: string | null = null;


}

class Param {
  public type: string | null = null;
  public name: string | null = null;

  static parseTakes(content: string): Param[] {
    let takes = new Array<Param>();
    if (!content) return takes;
    if (!/takes\s+nothing/.test(content)) {
      const takeTypeStr = Type.types2RegExpString(Type.types(true));
      const takesRegExp = new RegExp(`takes\\s+(?<takeString>(${takeTypeStr})\\s+[a-zA-Z]\\w*(\\s*,\\s*(${takeTypeStr})\\s+[a-zA-Z]\\w*)*)`);
      if (takesRegExp.test(content)) {
        const result = takesRegExp.exec(content);
        if (result && result.groups && result.groups.takeString) {
          const takeString = result.groups.takeString;
          const takesStrings = takeString.split(/\s*,\s*/);
          takes = takesStrings.map(t => {
            const takeTypeName = t.trim().split(/\s+/);
            const param = new Param();
            param.type = takeTypeName[0];
            param.name = takeTypeName[1];
            return param; 
          }).filter(take => take && take.name && !JassUtils.isKeyword(take.name)); // 过滤名称为jass关键字的参数
        }
      }
    }
    return takes;
  }
}

/**
 * 用于解析出returns后面的类型
 * @param content 方法行
 */
const resolveReturnsType = (content: string): string | null => {
  let returns = null;
  if (!content || /returns\s+nothing/.test(content)) return returns;
  const statementTypeStr = Type.types2RegExpString(Type.types());
  const returnsRegexp = new RegExp(`returns\\s+(?<returns>${statementTypeStr})`);
  if (returnsRegexp.test(content)) {
    const result = returnsRegexp.exec(content);
    if (result && result.groups && result.groups.returns) {
      returns = result.groups.returns;
    }
  }
  return returns;
}

class Func {
  public origin: string | null = null;
  public modifier: Modifier = Modifier.Common;
  public name: string | null = null;
  public takes: Param[] = new Array<Param>();
  public returnType: string | null = null;
  public start: vscode.Position | null = null;
  public end: vscode.Position | null = null;
  public nameRange: vscode.Range | null = null;

  public locals: Local[] = new Array<Local>();

  static parse(content: string): Func | null {
    let func = null;
    if (/\bfunction\b/.test(content)) {
      func = new Func();
      func.modifier = resolveModifier(content);
      // 解析方法名称
      const nameRegExp = new RegExp(/function\s+(?<name>[a-zA-Z]\w*)/);
      if (nameRegExp.test(content)) {
        const result = nameRegExp.exec(content);
        if (result && result.groups && result.groups.name && !JassUtils.isKeyword(result.groups.name)) {
          func.name = result.groups.name;
        }
      }
      func.takes = Param.parseTakes(content);
      func.returnType = resolveReturnsType(content);
    }
    return func;
  }
}

class Local {
  public type: string | null = null;
  public name: string | null = null;
  public isArray: boolean = false;
  public range: vscode.Range | null = null;
  public nameRange: vscode.Range | null = null;
}

class Import {

}

class TextMacro {
  public origin: string | null = null;
  public name: string | null = null;
  public takes: string[] = [];
  public content: string | null = null;
  public range: vscode.Range | null = null;
  public nameRange: vscode.Range | null = null;
}

class Library {
  public origin: string | null = null;
  public name: string | null = null;
  public scopes: Scope[] = new Array<Scope>();
  public initializer: string | null = null;
  public needs: string[] = new Array<string>();
  public globals: Global[] = new Array<Global>();
  public functions: Func[] = [];
  public start: vscode.Position | null = null;
  public end: vscode.Position | null = null;
  public nameRange: vscode.Range | null = null;
}

class Scope {
  public origin: string | null = null;
  public name: string | null = null;
  public scopes: Scope[] = new Array<Scope>();
  public initializer: string | null = null;
  public globals: Global[] = new Array<Global>();
  public functions: Func[] = [];
  public start: vscode.Position | null = null;
  public end: vscode.Position | null = null;
  public nameRange: vscode.Range | null = null;

}

class Member {
  public modifier: Modifier = Modifier.Common;
  public isStatic: boolean = false;
  public type: string | null = null;
  public isArray: boolean = false;
  public name: string | null = null;
  public range: vscode.Range | null = null;
  public nameRange: vscode.Range | null = null;
  public origin: string | null = null;

  static parse(content: string): Member | null {
    const memberTypeStr = Type.types2RegExpString(Type.types());
    const interfaceMemberRegExp = new RegExp(`((?<modifier>private|public)\\s+)?((?<isStatic>static)\\s+)?(?<type>${memberTypeStr})\\s+((?<isArray>array)\\s+)?(?<name>[a-zA-Z]\\w*)`);
    if (interfaceMemberRegExp.test(content)) {
      const member = new Member();
      const result = interfaceMemberRegExp.exec(content);
      if (result && result.groups) {
        if (result.groups.modifier) {
          if (result.groups.modifier == Modifier.Private) {
            member.modifier = Modifier.Private;
          } else if (result.groups.modifier == Modifier.Public) {
            member.modifier = Modifier.Public;
          }
        }
        if (result.groups.isStatic) {
          member.isStatic = true;
        }
        if (result.groups.type) {
          member.type = result.groups.type;
        }
        if (result.groups.isArray) {
          member.isArray = true;
        }
        if (result.groups.name) {
          member.name = result.groups.name;
        }
      }
      return member;
    } else return null;
  }
}

class Method {
  public modifier: Modifier = Modifier.Common;
  public isStatic: boolean = false;
  public name: string | null = null;
  public takes: Param[] = new Array<Param>();
  public returns: string | null = null;
  public start: vscode.Position | null = null;
  public end: vscode.Position | null = null;
  public nameRange: vscode.Range | null = null;
  public origin: string | null = null;

  static parse(content: string): Method | null {
    let method = null;
    const interfaceMethodRegExp = new RegExp(/((?<modifier>private|public)\s+)?((?<isStatic>static)\s+)?method\s+(?<name>[a-zA-Z]\w*)/);
    if (content && interfaceMethodRegExp.test(content)) {
      method = new Method();
      const result = interfaceMethodRegExp.exec(content);
      if (result && result.groups) {
        if (result.groups.modifier) {
          if (result.groups.modifier == Modifier.Private) {
            method.modifier = Modifier.Private;
          } else if (result.groups.modifier == Modifier.Public) {
            method.modifier = Modifier.Public;
          }
        }
        if (result.groups.isStatic) {
          method.isStatic = true;
        }
        if (result.groups.isStatic) {
          method.isStatic = true;
        }
        if (result.groups.name && !JassUtils.isKeyword(result.groups.name)) {
          method.name = result.groups.name;
        }
      }
      method.takes = Param.parseTakes(content);
      method.returns = resolveReturnsType(content);
    }
    return method;
  }
}

class Struct {
  public name: string | null = null;
  public extends: string | null = null;
  public members: Member[] = new Array<Member>();
  public methods: Method[] = new Array<Method>();
  public start: vscode.Position | null = null;
  public end: vscode.Position | null = null;
  public nameRange: vscode.Range | null = null;
  public origin: string | null = null;

  static parse(content: string): Struct | null {
    let struct = null;
    const nameRegExp = new RegExp(/struct\s+(?<name>[a-zA-Z][a-zA-Z\d]*)\b/);
    if (nameRegExp.test(content)) {
      struct = new Struct();
      const result = nameRegExp.exec(content);
      if (result && result.groups && result.groups.name) {
        struct.name = result.groups.name;
      }
    }
    const extendsRegExp = new RegExp(/extends\s+(?<extends>[a-zA-Z][a-zA-Z\d]*)/);
    if (extendsRegExp.test(content) && struct) {  // 若果struct未命名，就算声明了init方法,照样无视
      const result = extendsRegExp.exec(content);
      if (result && result.groups && result.groups.extends) {
        struct.extends = result.groups.extends;
      }
    }
    return struct;
  }

}

class Interface {
  public name: string | null = null;
  public members: Member[] = new Array<Member>();
  public methods: Method[] = new Array<Method>();
  public start: vscode.Position | null = null;
  public end: vscode.Position | null = null;
  public nameRange: vscode.Range | null = null;
  public origin: string | null = null;
}

class ArrayType {

}

class Error {
  public name: string = "error";
  public message: string = "error";
  public range: vscode.Range | null = null;
  public uri: vscode.Uri | null = null;
}

/**
 * 全局塊
 * 方法
 * 如果開啓了vjass.enable
 * 文本宏塊
 * lib
 * scope
 * 結構塊
 * 接口塊
 * 運算符重載
 * 函數對象
 * 數組對象
 */
class Jass {
  public comments: Comment[] = new Array<Comment>();
  public filePath: string = "";
  public globals: Global[] = new Array<Global>();
  public imports: Import[] = new Array<Import>();
  public funcs: Func[] = new Array<Func>();
  public textMacros: TextMacro[] = new Array<TextMacro>();
  public librarys: Library[] = new Array<Library>();
  public scopes: Scope[] = new Array<Scope>();
  public structs: Struct[] = new Array<Struct>();
  public interfaces: Interface[] = new Array<Interface>();
  public arrayTypes: ArrayType[] = new Array<ArrayType>();
  public errors: Error[] = new Array<Error>();

  /**
   * 
   * @param uri j or ai 文件路徑
   */
  static parse(uri: string) {

  }

  static parseContent(content: string): Jass {
    if (!content) return new Jass;
    const lineTexts = JassUtils.content2Lines(content);
    /**
     * text macro -> scope -> library -> interface -> struct -> function -> global -> array object -> interface function -> import -> comment
     * text macro {all}
     * scope {scope, interface, struct, function, global, array object, interface function}
     * library {interface, struct, function, global, array object, interface function}
     * interface {function, global}
     * struct {function, global}
     * function{array object,interface function }
     * text macro -> //! text macro name takes 
     */
    const linesParse = () => {
      const jass = new Jass();

      let inTextMacro = false;  // 记录是否进入文本宏
      let textMacroBlocks = []; // 文本宏内容
      let textMacroStartLine = 0; // 文本宏开始行
      let inInterface = false;
      let interfaceBlocks = [];
      let interfaceStartLine = 0;
      let inScope = false;  // 是否进入域
      let scopeBlocks = []; // 域内容
      let scopeStartLine = 0; // 域开始行
      let inScopeField = 0; // 域深度
      let inLibrary = false;  // 是否进入库
      let libraryBlocks = []; // 库内容
      let libraryStartLine = 0; // 库开始行
      let inStruct = false;
      let structBlocks: string[] = [];
      let structStartLine = 0;
      let inFunction = false;
      let functionBlocks: string[] = [];
      let functionStartLine: number = 0;
      let inGlobals = false;
      let globalBlocks: string[] = [];
      let globalStartLine = 0;

      let inMethod = false; // 仅用于struct，interface中无需闭合

      let lastFunction = null;  // 最后进入的方法，用于保存生命周期，方便后续local设置

      const findScopes = (scopes: Scope[], deep: number): Scope[] => {
        if (deep > 1) {
          let s = scopes;
          for (let d = 1; d < deep; d++) {
            s = s[s.length - 1].scopes;
          }
          return s;
        } else {
          return scopes;
        }
      }

      for (let i = 0; i < lineTexts.length; i++) {
        const lineText = lineTexts[i];
        /**
         * 获取第一个字符开始的下标
         */
        const getStartIndex = (): number => lineText.length - lineText.trimLeft().length;
        if (/^\s*\/\/!\s+textmacro/.test(lineText)) {
          inTextMacro = true;
          const textMacro = new TextMacro();
          textMacro.name = "";
          textMacro.takes = [];
          textMacro.content = "";
          textMacro.range = null;
          textMacro.nameRange = null;
          textMacro.origin = "";
          jass.textMacros.push(textMacro);
        } else if (/^\s*\/\/!\s+endtextmacro/.test(lineText)) {
          inTextMacro = false;
        } else if (inTextMacro) {
          jass.textMacros[jass.textMacros.length - 1].content += lineText;
        } else if (/^\s*\/\/!\s+import/.test(lineText)) {
        } else if (/^\s*\/\//.test(lineText)) {
        } else if (/^\s*globals/.test(lineText)) {
          inGlobals = true;
        } else if (/^\s*endglobals/.test(lineText)) {
          inGlobals = false;
        } else if (inGlobals) { // 在global块时会无视其他语法行
          const globalRegExp = new RegExp(/((?<modifier>private|public)\s+)?((?<isConstant>constant)\s+)?(?<type>[a-zA-Z]+)\s+((?<isArray>array)\s+)?(?<name>[a-zA-Z]\w*)(?=\s*=|\s*\n|\s*\/\/)/);  // 必须保证name后面为=号或者换行或者单行注释
          if (globalRegExp.test(lineText)) {
            const global = new Global();
            const result = globalRegExp.exec(lineText);
            if (result && result.groups) {
              if (result.groups.modifier) {
                if (result.groups.modifier == Modifier.Private) {
                  global.modifier = Modifier.Private;
                } else if (result.groups.modifier == Modifier.Public) {
                  global.modifier = Modifier.Public;
                }
              }
              if (result.groups.isConstant) {
                global.isConstant = true;
              }
              if (result.groups.type) {
                global.type = result.groups.type;
              }
              if (result.groups.isArray) {
                global.isArray = true;
              }
              if (result.groups.name) {
                global.name = result.groups.name;
              }
            }
            if (global.modifier == Modifier.Common) {
              jass.globals.push(global);
            } else {
              if (inLibrary) {
                if (inScopeField > 0) {
                  const scopes = findScopes(jass.librarys[jass.librarys.length - 1].scopes, inScopeField);
                  const scope = scopes[scopes.length - 1];
                  if (scope) {
                    scope.globals.push(global);
                  }
                } else {
                  jass.librarys[jass.librarys.length - 1].globals.push(global);
                }
              } else if (inScopeField > 0) {
                const scopes = findScopes(jass.scopes, inScopeField);
                const scope = scopes[scopes.length - 1];
                if (scope) {
                  scope.globals.push(global);
                }
              }
            }
          }
        } else if (/^\s*type/.test(lineText)) {
        } else if (/^\s*function\s+interface/.test(lineText)) {
        } else if (/^\s*library/.test(lineText) && inScopeField == 0) { // 保证lib不被包含再scope中
          inLibrary = true;
          const library = new Library();

          jass.librarys.push(library);
        } else if (/^\s*endlibrary/.test(lineText)) {
          inLibrary = false;
        } else if (/^\s*scope/.test(lineText)) {
          inScopeField++;
          /**
           * 解析scope头部
           */
          const parseScopeHead = (): Scope => {
            // 分析首行
            const scope = new Scope();
            const nameRegExp = /scope\s+(?<name>[a-zA-Z]\w*)/;
            if (nameRegExp.test(lineText)) {
              const result = nameRegExp.exec(lineText);
              if (result) {
                const groups = result.groups;
                if (groups) {
                  scope.name = groups.name;
                  scope.start = new vscode.Position(i, lineText.indexOf("scope"));
                  const nameIndex = lineText.indexOf(scope.name);
                  scope.nameRange = new vscode.Range(i, nameIndex, i, nameIndex + scope.name.length);
                }
              }
            }
            if (!scope.name) return scope; // scope未命名时返回空scope
            const initRegExp = /initializer\s+(?<initializer>[a-zA-Z]\w*)/;
            if (initRegExp.test(lineText)) {
              const result = initRegExp.exec(lineText);
              if (result && result.groups) {
                if (result.groups.initializer) {
                  scope.initializer = result.groups.initializer;
                }
              }
            }
            return scope;
          }
          const scopes = inLibrary ? findScopes(jass.librarys[jass.librarys.length - 1].scopes, inScopeField) : findScopes(jass.scopes, inScopeField);
          scopes.push(parseScopeHead());
        } else if (/^\s*endscope/.test(lineText)) {
          const scopes = inLibrary ? findScopes(jass.librarys[jass.librarys.length - 1].scopes, inScopeField) : findScopes(jass.scopes, inScopeField);
          const scope = scopes[scopes.length - 1];
          const EndscopeKeyword = "endscope";
          scope.end = new vscode.Position(i, lineText.indexOf(EndscopeKeyword) + EndscopeKeyword.length);
          scope.origin = `scope ${scope.name ? scope.name : ""}${scope.initializer ? " initializer " + scope.initializer : ""}\n
            globals\n
            ${scope.globals.map(global => global.origin).join("\n")}
            endglobals\n
            ${scope.functions.map(func => func.origin).join("\n")}
            ${scope.scopes.map(scp => scp.origin).join("\n")}
          endscope`;
          if (inScopeField > 0) {
            inScopeField--;
          }
        } else if (/^\s*interface/.test(lineText)) {
          const inter = new Interface();
          const nameRegExp = new RegExp(/interface\s+(?<name>[a-zA-Z][a-zA-Z\d]*)\b/);
          if (nameRegExp.test(lineText)) {
            const result = nameRegExp.exec(lineText);
            if (result && result.groups && result.groups.name) {
              inter.name = result.groups.name;
              inter.nameRange = new vscode.Range(i, lineText.indexOf(inter.name), i, lineText.indexOf(inter.name) + inter.name.length);
            }
          }
          inter.start = new vscode.Position(i, getStartIndex());
          jass.interfaces.push(inter);
          inInterface = true;
        } else if (/^\s*endinterface/.test(lineText)) {
          const inter = jass.interfaces[jass.interfaces.length - 1];
          if (inter) {
            if (lineText.includes("endinterface")) {
              inter.end = new vscode.Position(i, lineText.length - lineText.trimLeft().length);
            }
          }
          inInterface = false;
        } else if (inInterface) {  // 进入interface块时，只识别成员和
          /*
          解析member和method
          */
          if (/\bmethod\b/.test(lineText)) {
            const method = Method.parse(lineText);
            if (method) {
              if (method.name) {
                const nameIndex = lineText.indexOf(method.name);
                if (nameIndex > -1) method.nameRange = new vscode.Range(i, nameIndex, i, nameIndex + method.name.length);
              }
              method.start = new vscode.Position(i, lineText.length - lineText.trimLeft().length);
              const inter = jass.interfaces[jass.interfaces.length - 1];
              if (inter) {
                inter.methods.push(method);
              }
            }
          } else {
            const member = Member.parse(lineText);
            if (member) {
              if (member.name) {
                const nameIndex = lineText.indexOf(member.name);
                if (nameIndex > -1) member.nameRange = new vscode.Range(i, nameIndex, i, nameIndex + member.name.length);
              }
              member.range = new vscode.Range(i, getStartIndex(), i, lineText.length);
              const inter = jass.interfaces[jass.interfaces.length - 1];
              if (inter) {
                inter.members.push(member);
              }
            }
          }
        } else if (/^\s*struct/.test(lineText)) {
          const struct = Struct.parse(lineText);
          if (struct) {
            if (struct.name) {
              const nameIndex = lineText.indexOf(struct.name);
              struct.start = new vscode.Position(i, nameIndex);
              struct.nameRange = new vscode.Range(i, nameIndex, i, nameIndex + struct.name.length);
            }
            struct.start = new vscode.Position(i, getStartIndex());
            jass.structs.push(struct);
          }
          inStruct = true;
        } else if (/^\s*endstruct/.test(lineText)) {
          if (inStruct) {
            const struct = jass.structs[jass.structs.length - 1];
            if (struct) struct.end = new vscode.Position(i, getStartIndex());
          }
          inStruct = false;
        } else if (inStruct) {
          if (/\bmethod\b/.test(lineText)) {
            const member = Member.parse(lineText);
            if (member) {
              if (member.name) {
                const nameIndex = lineText.indexOf(member.name);
                if (nameIndex > -1) member.nameRange = new vscode.Range(i, nameIndex, i, nameIndex + member.name.length);
              }
              member.range = new vscode.Range(i, getStartIndex(), i, lineText.length);
              const struct = jass.structs[jass.structs.length - 1];
              if (struct) {
                struct.members.push(member);
              }
            }
          } else {
            const member = Member.parse(lineText);
            if (member) {
              if (member.name) {
                const nameIndex = lineText.indexOf(member.name);
                if (nameIndex > -1) member.nameRange = new vscode.Range(i, nameIndex, i, nameIndex + member.name.length);
              }
              member.range = new vscode.Range(i, getStartIndex(), i, lineText.length);
              const struct = jass.structs[jass.structs.length - 1];
              if (struct) {
                struct.members.push(member);
              }
            }
          }
        } else if (/^\s*function(?!\s+interface)/.test(lineText) || /^\s*private\s+function/.test(lineText) || /^\s*public\s+function/.test(lineText)) {
          const func = Func.parse(lineText);
          if (func) {
            if (func.name) {
              const nameIndex = lineText.indexOf(func.name);
              func.nameRange = new vscode.Range(i, nameIndex, i, nameIndex + func.name.length);
            }
            func.start = new vscode.Position(i, getStartIndex());
            if (func.modifier == Modifier.Private || func.modifier == Modifier.Public) { // 有修饰符时
              if (inLibrary) {
                if (inScopeField > 0) {
                  const scopes = findScopes(jass.librarys[jass.librarys.length - 1].scopes, inScopeField);
                  scopes[scopes.length - 1].functions.push(func);
                } else {
                  jass.librarys[jass.librarys.length - 1].functions.push(func);
                }
              } else if (inScopeField > 0) {
                const scopes = findScopes(jass.scopes, inScopeField);
                scopes[scopes.length - 1].functions.push(func);
              }
            } else {
              if (inLibrary) {
                const lib = jass.librarys[jass.librarys.length - 1];
                if (lib.initializer == func.name) {
                  lib.functions.push(func);
                } else {
                  jass.funcs.push(func);
                }
              } else {
                jass.funcs.push(func);
              }
            }
            lastFunction = func;
          }
          inFunction = true;
        } else if (/^\s*endfunction/.test(lineText)) {
          if (inFunction) {
            const end = new vscode.Position(i, lineText.indexOf("endfunction") + "endfunction".length);
            if (inLibrary) {
              if (inScopeField > 0) {
                const lib = jass.librarys[jass.librarys.length - 1];
                const scopes = findScopes(lib.scopes, inScopeField);
                scopes[scopes.length - 1].end = end;
              } else {
                jass.librarys[jass.librarys.length - 1].end = end;
              }
            } else if (inScopeField > 0) {
              const scopes = findScopes(jass.scopes, inScopeField);
              scopes[scopes.length - 1].end = end;
            } else {
              jass.funcs[jass.funcs.length - 1].end = end;
            }
            inFunction = false;
          }
        } else if (inFunction) {
          const functionRegExp = new RegExp(/local\s+(?<type>[a-zA-Z]+)(\s+(?<hasArray>array))?\s+(?<name>[a-zA-Z]\w*)/);
          if (functionRegExp.test(lineText)) {
            const local = new Local();
            const result = functionRegExp.exec(lineText);
            if (result && result.groups) {
              if (result.groups.type) {
                local.type = result.groups.type;
              }
              if (result.groups.name) {
                local.name = result.groups.name;
                local.nameRange = new vscode.Range(i, lineText.indexOf(local.name), i, lineText.indexOf(local.name) + local.name.length);
              }
              if (result.groups.hasArray) {
                local.isArray = true;
              }
            }
            local.range = new vscode.Range(i, getStartIndex(), i, lineText.length);

            if (lastFunction) { //  进入方法行时定义
              lastFunction.locals.push(local);
            }
          }
        }
        if (/^\s*native/.test(lineText) || /^\s*constant\s+native/.test(lineText)) {
        }

      }
      return jass;
    }
    return linesParse();
  }

  static parseContent1(content: string): Jass {
    const jass = new Jass();
    if (vscode.workspace.getConfiguration().jass.vjass.support.enable || vscode.workspace.getConfiguration().jass.zinc.support.enable) { // 开启vjass支持
      if (vscode.workspace.getConfiguration().jass.vjass.support.enable) {

      }
    } else {

    }
    const isLatter = (char: string): boolean => ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"].includes(char);
    const isSpace = (char: string): boolean => [" ", "\t"].includes(char);
    const isNewLine = (char: string): boolean => "\n" == char;

    let field: number = 0;
    let inLineComment: boolean = false; // 单行注释
    let inBlockComment: boolean = false; // 多行注释
    let inString: boolean = false; // 字符串
    let inLibrary: boolean = false; // 
    let inLibraryNaming = false;
    let libraryName: string | null = null;
    let inInitializer: boolean = false;
    let initializerNaming: boolean = false;
    let inScope: boolean = false; // 
    let inFunction: boolean = false; // 
    let inStruct: boolean = false; // 
    let inInterface: boolean = false; // 
    let inMethod: boolean = false; // 
    let inOperator: boolean = false; // 
    let inInterfaceFunction: boolean = false; // 
    let inTextMacros: boolean = false; // 

    let startLine: number = 0;
    let startCharacter: number = 0;

    let line: number = 0;
    let character: number = 0;
    let word: string = "";
    /*
    1=/
    2=//
    3=/*
    4=/** *
    5=/* *\/
    */
    let status: number = 0;
    for (let i = 0; i < content.length; i++) {
      const char = (index: number): string => content.charAt(index);
      const c = content.charAt(i);
      if (inLineComment == false && inBlockComment == false && inString == false && c == "/" && content.charAt(i - 1) == "/") {
        inLineComment = true;
      } else if (inLineComment == false && inBlockComment == false && inString == false && c == "*" && content.charAt(i - 1) == "/") {
        inBlockComment = true;
      } else if (inLineComment == false && inBlockComment == false && inString == false && c == '"') {
        inString = true;
      } else if (inLineComment && c == "\n") {
        inLineComment = false;
      } else if (inBlockComment && c == "*" && content.charAt(i + 1) == "/") {
        inBlockComment = false;
      } else if (inString && ((c == '"' && content.charAt(i - 1) == "\\") || c == "\n")) {
        inString = false;
      } else if (
        inLineComment == false &&
        inBlockComment == false &&
        inString == false &&
        inLibrary == false &&
        inScope == false &&
        inFunction == false &&
        inStruct == false &&
        inInterface == false &&
        inMethod == false &&
        inOperator == false &&
        inInterfaceFunction == false &&
        inTextMacros == false &&
        c == "y" &&
        char(i - 1) == "r" &&
        char(i - 2) == "a" &&
        char(i - 3) == "r" &&
        char(i - 4) == "b" &&
        char(i - 5) == "i" &&
        char(i - 6) == "l" &&
        isLatter(char(i - 7)) == false &&
        isLatter(char(i + 1)) == false) { // library
        inLibrary = true;
      } else if (
        inLibrary &&
        c == "y" &&
        char(i - 1) == "r" &&
        char(i - 2) == "a" &&
        char(i - 3) == "r" &&
        char(i - 4) == "b" &&
        char(i - 5) == "i" &&
        char(i - 6) == "l" &&
        char(i - 6) == "d" &&
        char(i - 6) == "n" &&
        char(i - 6) == "e") {

      }
      character++;
    }
    return jass;
  }
}

class DefaultCompletionItemProvider implements vscode.CompletionItemProvider {
  public resolveCompletionItem(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
    return item;
  }

  public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    try {
      const jass = Jass.parseContent(document.getText());
      console.log(jass);
    } catch (err) { console.error(err) }
    return [];
  }
}

vscode.languages.registerCompletionItemProvider(language, new DefaultCompletionItemProvider, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z");