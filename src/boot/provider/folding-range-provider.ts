import * as vscode from 'vscode';

const globalStartRegExp = new RegExp(`^\\s*globals\\b`);
const globalEndRegExp = new RegExp(`^\\s*endglobals\\b`);

const functionStartRegExp = new RegExp(`^\\s*((private|public|static)\\s+)?function\\b`);
const functionEndRegExp = new RegExp(`^\\s*endfunction\\b`);

const libraryStartRegExp = new RegExp(`^\\s*library\\b`);
const libraryEndRegExp = new RegExp(`^\\s*endlibrary\\b`);

const ifStartRegExp = new RegExp(`^\\s*if\\b`);
const elseRegExp = new RegExp(`^\\s*else\\b`);
const elseIfRegExp = new RegExp(`^\\s*elseif\\b`);
const ifEndRegExp = new RegExp(`^\\s*endif\\b`);

const loopStartRegExp = new RegExp(`^\\s*loop\\b`);
const loopEndRegExp = new RegExp(`^\\s*endloop\\b`);

const regionStartRegExp = new RegExp(`^\\s*//\\s*region\\b`);
const endRegionRegExp = new RegExp(`^\\s*//\\s*endregion\\b`);

class ElseIf {
  public line: number;

  constructor(line: number) {
    this.line = line;
  }
}

class ElseIfArray extends Array<ElseIf>{

  public first = () => {
    return this[0];
  }

  public last = () => {
    return this[this.length - 1];
  }

}

class If {
  public line: number;
  public elseIfArray: ElseIfArray = new ElseIfArray();
  public elseLine: number | null = null;

  constructor(line: number) {
    this.line = line;
  }

}

class IfArray extends Array<If>{

  public first = () => {
    return this[0];
  }

  public last = () => {
    return this[this.length - 1];
  }

}

class Loop {
  public line:number;

  constructor(line: number) {
    this.line = line;
  }
}

class LoopArray extends Array<Loop> {
  public first = () => {
    return this[0];
  }

  public last = () => {
    return this[this.length - 1];
  }
}

class FoldingRangeProvider implements vscode.FoldingRangeProvider {

  provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): vscode.ProviderResult<vscode.FoldingRange[]> {

    const foldings = new Array<vscode.FoldingRange>();

    const content = document.getText();
    let lines:string[] = [];
    for (let index = 0; index < document.lineCount; index++) {
      const element = document.lineAt(index);
      lines.push(element.text);
    }

    let inGlobal = false;
    let globalLine = 0;

    let inFunction = false;
    let functionLine = 0;

    let inLibrary = false;
    let libraryLine = 0;

    const ifArray = new IfArray();

    const loopArray = new LoopArray();

    let inRegion = false;
    let regionLine = 0;

    lines.forEach((line, index) => {
      // if
      if (ifStartRegExp.test(line)) {
        ifArray.push(new If(index));
      } else if (elseRegExp.test(line)) {
        // 第一種 if else
        // 第二種 elseif else
        if (ifArray.length > 0) {
          if (ifArray.last().elseIfArray.length > 0) { // if中含有elseif,開始行為elseif
            if (index - ifArray.last().elseIfArray.last().line > 1) {
              const folding = new vscode.FoldingRange(ifArray.last().elseIfArray.last().line, index - 1);
              foldings.push(folding);
            }
          } else { // if -> else
            if (index - ifArray.last().line > 1) {
              const folding = new vscode.FoldingRange(ifArray.last().line, index - 1);
              foldings.push(folding);
            }
          }
          ifArray.last().elseLine = index;
        }
      } else if (elseIfRegExp.test(line)) {
        if (ifArray.length > 0) {
          if (ifArray.last().elseIfArray.length > 0) {
            if (index - ifArray.last().elseIfArray.last().line > 1) {
              const folding = new vscode.FoldingRange(ifArray.last().elseIfArray.last().line, index - 1);
              foldings.push(folding);
            }
          } else {
            if (index - ifArray.last().line > 1) {
              const folding = new vscode.FoldingRange(ifArray.last().line, index - 1);
              foldings.push(folding);
            }
          }
          ifArray.last().elseIfArray.push(new ElseIf(index));
        }
      } else if (ifEndRegExp.test(line)) {
        const elseLine = ifArray.last().elseLine;
        if (elseLine) {
          if (index - elseLine > 1) {
            const folding = new vscode.FoldingRange(elseLine, index - 1);
            foldings.push(folding);
          }
        } else if (ifArray.length > 0) {
          if (ifArray.last().elseIfArray.length > 0) {
            if (index - ifArray.last().elseIfArray.last().line > 1) {
              const folding = new vscode.FoldingRange(ifArray.last().elseIfArray.last().line, index - 1);
              foldings.push(folding);
            }
          } else {
            if (index - ifArray.last().line > 1) {
              const folding = new vscode.FoldingRange(ifArray.last().line, index - 1);
              foldings.push(folding);
            }
          }
          ifArray.pop();
        }
      }

      if (loopStartRegExp.test(line)) {
        loopArray.push(new Loop(index));
      } else if (loopEndRegExp.test(line)) {
        if (loopArray.length > 0) {
          if(index - loopArray.last().line > 1) {
            const folding = new vscode.FoldingRange(loopArray.last().line, index - 1);
            foldings.push(folding);
          }
          loopArray.pop();
        }
      }
      // global
      else if (globalStartRegExp.test(line)) {
        inGlobal = true;
        globalLine = index;
      } else if (globalEndRegExp.test(line)) {
        if (inGlobal == true) {
          if(index - globalLine > 1) {
            const folding = new vscode.FoldingRange(globalLine, index - 1);
            foldings.push(folding);
            inGlobal = false;
          }
        }
      }
      // function
      else if (functionStartRegExp.test(line)) {
        inFunction = true;
        functionLine = index;
      } else if (functionEndRegExp.test(line)) {
        if (inFunction == true) {
          if (index - functionLine > 1) {
            const folding = new vscode.FoldingRange(functionLine, index);
            foldings.push(folding);
            inFunction = false;
          }
        }
      }
      // library
      else if (libraryStartRegExp.test(line)) {
        inLibrary = true;
        libraryLine = index;
      } else if (libraryEndRegExp.test(line)) {
        if (inLibrary == true) {
          if(index - libraryLine > 1) {
            const folding = new vscode.FoldingRange(libraryLine, index - 1);
            foldings.push(folding);
            inLibrary = false;
          }
        }
      }
      // region
      else if (regionStartRegExp.test(line)) {
        inRegion = true;
        regionLine = index;
      } else if (endRegionRegExp.test(line)) {
        if (inRegion == true) {
          if(index - regionLine > 1) {
            const folding = new vscode.FoldingRange(regionLine, index - 1, vscode.FoldingRangeKind.Region);
            foldings.push(folding);
            inRegion = false;
          }
        }
      }

    });


    return foldings;
  }

}

vscode.languages.registerFoldingRangeProvider("jass", new FoldingRangeProvider);