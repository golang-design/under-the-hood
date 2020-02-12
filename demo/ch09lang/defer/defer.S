TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/ch11type/types/defer/defer.go
  defer.go:3		0x1056ff0		65488b0c2530000000	MOVQ GS:0x30, CX			
  defer.go:3		0x1056ff9		483b6110		CMPQ 0x10(CX), SP			
  defer.go:3		0x1056ffd		766b			JBE 0x105706a				
  defer.go:3		0x1056fff		4883ec70		SUBQ $0x70, SP				
  defer.go:3		0x1057003		48896c2468		MOVQ BP, 0x68(SP)			
  defer.go:3		0x1057008		488d6c2468		LEAQ 0x68(SP), BP			
  defer.go:4		0x105700d		c744241010000000	MOVL $0x10, 0x10(SP)			
  defer.go:4		0x1057015		488d056c080200		LEAQ go.func.*+74(SB), AX		
  defer.go:4		0x105701c		4889442428		MOVQ AX, 0x28(SP)			
  defer.go:4		0x1057021		488d05f7c80100		LEAQ go.string.*+2815(SB), AX		
  defer.go:4		0x1057028		4889442458		MOVQ AX, 0x58(SP)			
  defer.go:4		0x105702d		48c74424600d000000	MOVQ $0xd, 0x60(SP)			
  defer.go:4		0x1057036		488d442410		LEAQ 0x10(SP), AX			
  defer.go:4		0x105703b		48890424		MOVQ AX, 0(SP)				
  defer.go:4		0x105703f		e87c02fdff		CALL runtime.deferprocStack(SB)		
  defer.go:4		0x1057044		85c0			TESTL AX, AX				
  defer.go:4		0x1057046		7512			JNE 0x105705a				
  defer.go:4		0x1057048		eb00			JMP 0x105704a				
  defer.go:5		0x105704a		90			NOPL					
  defer.go:5		0x105704b		e8d00afdff		CALL runtime.deferreturn(SB)		
  defer.go:5		0x1057050		488b6c2468		MOVQ 0x68(SP), BP			
  defer.go:5		0x1057055		4883c470		ADDQ $0x70, SP				
  defer.go:5		0x1057059		c3			RET					
  defer.go:4		0x105705a		90			NOPL					
  defer.go:4		0x105705b		e8c00afdff		CALL runtime.deferreturn(SB)		
  defer.go:4		0x1057060		488b6c2468		MOVQ 0x68(SP), BP			
  defer.go:4		0x1057065		4883c470		ADDQ $0x70, SP				
  defer.go:4		0x1057069		c3			RET					
  defer.go:3		0x105706a		e8019dffff		CALL runtime.morestack_noctxt(SB)	
  defer.go:3		0x105706f		e97cffffff		JMP main.main(SB)			
  :-1			0x1057074		cc			INT $0x3				
  :-1			0x1057075		cc			INT $0x3				
  :-1			0x1057076		cc			INT $0x3				
  :-1			0x1057077		cc			INT $0x3				
  :-1			0x1057078		cc			INT $0x3				
  :-1			0x1057079		cc			INT $0x3				
  :-1			0x105707a		cc			INT $0x3				
  :-1			0x105707b		cc			INT $0x3				
  :-1			0x105707c		cc			INT $0x3				
  :-1			0x105707d		cc			INT $0x3				
  :-1			0x105707e		cc			INT $0x3				
  :-1			0x105707f		cc			INT $0x3				
