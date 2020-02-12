TEXT runtime.main.func1(SB) /usr/local/Cellar/go/1.13.4/libexec/src/runtime/proc.go
  proc.go:133		0x10489f0		65488b0c2530000000	MOVQ GS:0x30, CX			
  proc.go:133		0x10489f9		483b6110		CMPQ 0x10(CX), SP			
  proc.go:133		0x10489fd		7631			JBE 0x1048a30				
  proc.go:133		0x10489ff		4883ec18		SUBQ $0x18, SP				
  proc.go:133		0x1048a03		48896c2410		MOVQ BP, 0x10(SP)			
  proc.go:133		0x1048a08		488d6c2410		LEAQ 0x10(SP), BP			
  proc.go:134		0x1048a0d		488d059ce20200		LEAQ go.func.*+996(SB), AX		
  proc.go:134		0x1048a14		48890424		MOVQ AX, 0(SP)				
  proc.go:134		0x1048a18		48c744240800000000	MOVQ $0x0, 0x8(SP)			
  proc.go:134		0x1048a21		e84a11feff		CALL runtime.newm(SB)			
  proc.go:135		0x1048a26		488b6c2410		MOVQ 0x10(SP), BP			
  proc.go:135		0x1048a2b		4883c418		ADDQ $0x18, SP				
  proc.go:135		0x1048a2f		c3			RET					
  proc.go:133		0x1048a30		e8db0f0000		CALL runtime.morestack_noctxt(SB)	
  proc.go:133		0x1048a35		ebb9			JMP runtime.main.func1(SB)		
  :-1			0x1048a37		cc			INT $0x3				
  :-1			0x1048a38		cc			INT $0x3				
  :-1			0x1048a39		cc			INT $0x3				
  :-1			0x1048a3a		cc			INT $0x3				
  :-1			0x1048a3b		cc			INT $0x3				
  :-1			0x1048a3c		cc			INT $0x3				
  :-1			0x1048a3d		cc			INT $0x3				
  :-1			0x1048a3e		cc			INT $0x3				
  :-1			0x1048a3f		cc			INT $0x3				

TEXT runtime.main.func2(SB) /usr/local/Cellar/go/1.13.4/libexec/src/runtime/proc.go
  proc.go:157		0x1048a40		65488b0c2530000000	MOVQ GS:0x30, CX			
  proc.go:157		0x1048a49		483b6110		CMPQ 0x10(CX), SP			
  proc.go:157		0x1048a4d		7626			JBE 0x1048a75				
  proc.go:157		0x1048a4f		4883ec08		SUBQ $0x8, SP				
  proc.go:157		0x1048a53		48892c24		MOVQ BP, 0(SP)				
  proc.go:157		0x1048a57		488d2c24		LEAQ 0(SP), BP				
  proc.go:158		0x1048a5b		488b442410		MOVQ 0x10(SP), AX			
  proc.go:158		0x1048a60		803800			CMPB $0x0, 0(AX)			
  proc.go:158		0x1048a63		7509			JNE 0x1048a6e				
  proc.go:158		0x1048a65		488b2c24		MOVQ 0(SP), BP				
  proc.go:158		0x1048a69		4883c408		ADDQ $0x8, SP				
  proc.go:158		0x1048a6d		c3			RET					
  proc.go:159		0x1048a6e		e8bd58feff		CALL runtime.unlockOSThread(SB)		
  proc.go:159		0x1048a73		ebf0			JMP 0x1048a65				
  proc.go:157		0x1048a75		e8960f0000		CALL runtime.morestack_noctxt(SB)	
  proc.go:157		0x1048a7a		ebc4			JMP runtime.main.func2(SB)		
  :-1			0x1048a7c		cc			INT $0x3				
  :-1			0x1048a7d		cc			INT $0x3				
  :-1			0x1048a7e		cc			INT $0x3				
  :-1			0x1048a7f		cc			INT $0x3				

TEXT main.main(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/defer/deferreturn/defer.go
  defer.go:5		0x1051f50		65488b0c2530000000	MOVQ GS:0x30, CX			
  defer.go:5		0x1051f59		483b6110		CMPQ 0x10(CX), SP			
  defer.go:5		0x1051f5d		764c			JBE 0x1051fab				
  defer.go:5		0x1051f5f		4883ec20		SUBQ $0x20, SP				
  defer.go:5		0x1051f63		48896c2418		MOVQ BP, 0x18(SP)			
  defer.go:5		0x1051f68		488d6c2418		LEAQ 0x18(SP), BP			
  defer.go:6		0x1051f6d		48c7042400000000	MOVQ $0x0, 0(SP)			
  defer.go:6		0x1051f75		e846000000		CALL main.foo(SB)			
  defer.go:6		0x1051f7a		488b442408		MOVQ 0x8(SP), AX			
  defer.go:6		0x1051f7f		4889442410		MOVQ AX, 0x10(SP)			
  defer.go:6		0x1051f84		e8d730fdff		CALL runtime.printlock(SB)		
  defer.go:6		0x1051f89		488b442410		MOVQ 0x10(SP), AX			
  defer.go:6		0x1051f8e		48890424		MOVQ AX, 0(SP)				
  defer.go:6		0x1051f92		e84938fdff		CALL runtime.printint(SB)		
  defer.go:6		0x1051f97		e85433fdff		CALL runtime.printnl(SB)		
  defer.go:6		0x1051f9c		e83f31fdff		CALL runtime.printunlock(SB)		
  defer.go:7		0x1051fa1		488b6c2418		MOVQ 0x18(SP), BP			
  defer.go:7		0x1051fa6		4883c420		ADDQ $0x20, SP				
  defer.go:7		0x1051faa		c3			RET					
  defer.go:5		0x1051fab		e8607affff		CALL runtime.morestack_noctxt(SB)	
  defer.go:5		0x1051fb0		eb9e			JMP main.main(SB)			
  :-1			0x1051fb2		cc			INT $0x3				
  :-1			0x1051fb3		cc			INT $0x3				
  :-1			0x1051fb4		cc			INT $0x3				
  :-1			0x1051fb5		cc			INT $0x3				
  :-1			0x1051fb6		cc			INT $0x3				
  :-1			0x1051fb7		cc			INT $0x3				
  :-1			0x1051fb8		cc			INT $0x3				
  :-1			0x1051fb9		cc			INT $0x3				
  :-1			0x1051fba		cc			INT $0x3				
  :-1			0x1051fbb		cc			INT $0x3				
  :-1			0x1051fbc		cc			INT $0x3				
  :-1			0x1051fbd		cc			INT $0x3				
  :-1			0x1051fbe		cc			INT $0x3				
  :-1			0x1051fbf		cc			INT $0x3				

TEXT main.foo(SB) /Users/changkun/dev/go-under-the-hood/demo/7-lang/defer/deferreturn/defer.go
  defer.go:9		0x1051fc0		65488b0c2530000000	MOVQ GS:0x30, CX			
  defer.go:9		0x1051fc9		483b6110		CMPQ 0x10(CX), SP			
  defer.go:9		0x1051fcd		0f86b5000000		JBE 0x1052088				
  defer.go:9		0x1051fd3		4883ec48		SUBQ $0x48, SP				
  defer.go:9		0x1051fd7		48896c2440		MOVQ BP, 0x40(SP)			
  defer.go:9		0x1051fdc		488d6c2440		LEAQ 0x40(SP), BP			
  defer.go:9		0x1051fe1		48c744245800000000	MOVQ $0x0, 0x58(SP)			
  defer.go:11		0x1051fea		48837c24502a		CMPQ $0x2a, 0x50(SP)			
  defer.go:11		0x1051ff0		7502			JNE 0x1051ff4				
  defer.go:11		0x1051ff2		eb1a			JMP 0x105200e				
  defer.go:12		0x1051ff4		488b442450		MOVQ 0x50(SP), AX			
  defer.go:12		0x1051ff9		4889442458		MOVQ AX, 0x58(SP)			
  defer.go:12		0x1051ffe		90			NOPL					
  defer.go:12		0x1051fff		e8fc1bfdff		CALL runtime.deferreturn(SB)		
  defer.go:12		0x1052004		488b6c2440		MOVQ 0x40(SP), BP			
  defer.go:12		0x1052009		4883c448		ADDQ $0x48, SP				
  defer.go:12		0x105200d		c3			RET					
  defer.go:15		0x105200e		488d05a3ed0800		LEAQ main.mu(SB), AX			
  defer.go:15		0x1052015		48890424		MOVQ AX, 0(SP)				
  defer.go:15		0x1052019		e862f8ffff		CALL sync.(*Mutex).Lock(SB)		
  defer.go:16		0x105201e		c744240808000000	MOVL $0x8, 0x8(SP)			
  defer.go:16		0x1052026		488d05c34c0200		LEAQ go.func.*+1060(SB), AX		
  defer.go:16		0x105202d		4889442420		MOVQ AX, 0x20(SP)			
  defer.go:16		0x1052032		488d057fed0800		LEAQ main.mu(SB), AX			
  defer.go:16		0x1052039		4889442438		MOVQ AX, 0x38(SP)			
  defer.go:16		0x105203e		488d442408		LEAQ 0x8(SP), AX			
  defer.go:16		0x1052043		48890424		MOVQ AX, 0(SP)				
  defer.go:16		0x1052047		e8b415fdff		CALL runtime.deferprocStack(SB)		
  defer.go:16		0x105204c		85c0			TESTL AX, AX				
  defer.go:16		0x105204e		7528			JNE 0x1052078				
  defer.go:16		0x1052050		eb00			JMP 0x1052052				
  defer.go:17		0x1052052		488b0567ed0800		MOVQ main.seq(SB), AX			
  defer.go:17		0x1052059		48ffc0			INCQ AX					
  defer.go:17		0x105205c		4889055ded0800		MOVQ AX, main.seq(SB)			
  defer.go:18		0x1052063		4889442458		MOVQ AX, 0x58(SP)			
  defer.go:18		0x1052068		90			NOPL					
  defer.go:18		0x1052069		e8921bfdff		CALL runtime.deferreturn(SB)		
  defer.go:18		0x105206e		488b6c2440		MOVQ 0x40(SP), BP			
  defer.go:18		0x1052073		4883c448		ADDQ $0x48, SP				
  defer.go:18		0x1052077		c3			RET					
  defer.go:16		0x1052078		90			NOPL					
  defer.go:16		0x1052079		e8821bfdff		CALL runtime.deferreturn(SB)		
  defer.go:16		0x105207e		488b6c2440		MOVQ 0x40(SP), BP			
  defer.go:16		0x1052083		4883c448		ADDQ $0x48, SP				
  defer.go:16		0x1052087		c3			RET					
  defer.go:9		0x1052088		e88379ffff		CALL runtime.morestack_noctxt(SB)	
  defer.go:9		0x105208d		e92effffff		JMP main.foo(SB)			
